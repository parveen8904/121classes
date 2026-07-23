import { createServiceClient } from "@/lib/supabase/service";
import type { PlanInput, ClassItem, RevItem, TopicMIQ, TopicMeta, Scope } from "./engine";

// The saved study_plans.setup shape.
export type PlanSetup = {
  subjectId: string; startDate: string; examDate: string; speed: number; doneClasses: number;
  revisions?: number; exhaustiveScope?: Scope; pickedTopicIds?: string[];
  revScope1?: Exclude<Scope, "skip">; revScope2?: Exclude<Scope, "skip">;
  stageDays?: { exhaustive?: number; rr1?: number; rr2?: number; rr3?: number };
  holidays?: string[]; extraDays?: string[]; sundaysOn?: boolean;
};

// Copy the student's saved choices onto a freshly loaded engine input.
export function applySetup(input: PlanInput, s: PlanSetup): PlanInput {
  input.chosenSpeed = s.speed;
  input.revisionRounds = s.revisions;
  input.exhaustiveScope = s.exhaustiveScope;
  input.pickedTopicIds = s.pickedTopicIds;
  input.revScope1 = s.revScope1;
  input.revScope2 = s.revScope2;
  input.stageDays = s.stageDays;
  input.holidays = s.holidays;
  input.extraDays = s.extraDays;
  input.sundaysOn = s.sundaysOn;
  return input;
}

function parseQs(t: string | null | undefined): string[] {
  return (t ?? "").split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
}
function impLetter(imp: unknown): string {
  const v = imp && typeof imp === "object" ? (Object.values(imp as Record<string, unknown>)[0] as string) : null;
  const u = String(v ?? "").toUpperCase();
  return u === "A" || u === "B" || u === "C" ? u : "";
}
function impRank(imp: unknown): number {
  const m: Record<string, number> = { A: 1, B: 2, C: 3 };
  return m[impLetter(imp)] ?? 4;
}
// Rows come from section_stats (the tiny trigger-synced mirror) — NEVER from
// sections.config: selecting config across a subject detoasts megabytes of
// transcripts per call (measured 3.7s each) and starves the whole database.
type StatRow = { section_id: string; topic_id: string; type: string; duration_minutes: string | number | null; class_no: string | null };
const dur = (r: StatRow) => Number(r?.duration_minutes) || 0;
// Use the FINAL (continuous) class number, not the within-topic number.
// Class numbers may carry a "part" letter (7A, 7B — short continuations of
// class 7). Numeric part for ordering/labels; the letter marks a part.
const classNo = (r: StatRow) => parseInt(String(r?.class_no ?? "").replace(/[^0-9]/g, ""), 10) || 0;
const partSuffix = (r: StatRow) => (String(r?.class_no ?? "").match(/[A-Za-z]+$/)?.[0] ?? "");

// Build the engine input for one subject from the live content + planner config.
export async function loadPlanInput(opts: {
  subjectId: string; startDate: string; examDate: string; doneClasses?: number;
}): Promise<PlanInput | null> {
  const svc = createServiceClient();

  const { data: subj } = await svc
    .from("subjects")
    .select("title, plan_start_months_before_exam, plan_max_months, plan_target_months")
    .eq("id", opts.subjectId).maybeSingle();
  if (!subj) return null;

  const { data: cfgRow } = await svc.from("site_settings").select("value").eq("key", "planner_config").maybeSingle();
  let config: any = {};
  try { config = JSON.parse(cfgRow?.value ?? "{}"); } catch { config = {}; }

  const { data: topics } = await svc
    .from("topics")
    .select("id, title, order_index, importance, important_qs_rev1, important_qs_rev2")
    .eq("subject_id", opts.subjectId).eq("is_published", true);

  // CHAPTER order, always — a fresh plan must start at Class 1. (It used to
  // sort importance-A chapters first, so plans began mid-syllabus, e.g. at
  // Class 15 — students read that as "my plan is broken". Importance still
  // decides WHICH chapters are included via the A/A+B scopes, not the order.)
  const sorted = (topics ?? []).slice().sort((a, b) => ((a.order_index ?? 0) - (b.order_index ?? 0)) || (impRank(a.importance) - impRank(b.importance)));
  const topicIds = sorted.map((t) => t.id as string);

  const secs: StatRow[] = topicIds.length
    ? (((await svc.from("section_stats").select("section_id, topic_id, type, duration_minutes, class_no").in("topic_id", topicIds).eq("is_published", true)).data ?? []) as StatRow[])
    : [];

  const classes: ClassItem[] = [];
  const revisions: RevItem[] = [];
  const topicsMeta: TopicMeta[] = sorted.map((t) => ({ topicId: t.id as string, title: t.title as string, importance: impLetter(t.importance) }));
  for (const t of sorted) {
    const mine = secs.filter((s) => s.topic_id === t.id);
    const cls = mine
      .filter((s) => s.type === "full_class_video")
      // Order by class number; within a number the main class ("7") comes
      // before its parts ("7A", "7B").
      .sort((a, b) => classNo(a) - classNo(b) || partSuffix(a).localeCompare(partSuffix(b)));
    // A "part" (7A/7B — a ≤100-min continuation) is the SAME class sitting, so
    // merge it into its main class row: one plan entry, combined minutes. This
    // keeps the planner's class count equal to everywhere else on the site
    // (e.g. 137 classes, not 168 videos) while losing no watch time.
    type Row = { sectionId: string; no: number; minutes: number; parts: number };
    const merged: Row[] = [];
    for (const s of cls) {
      const no = classNo(s);
      const prev = merged[merged.length - 1];
      if (partSuffix(s) && prev && prev.no === no) {
        prev.minutes += dur(s) || 60;
        prev.parts++;
      } else {
        merged.push({ sectionId: s.section_id, no, minutes: dur(s) || 60, parts: 0 });
      }
    }
    merged.forEach((r, i) =>
      classes.push({
        sectionId: r.sectionId,
        topicId: t.id as string,
        topicTitle: t.title as string,
        importance: impLetter(t.importance),
        label: `Class ${r.no || i + 1}${r.parts ? ` (all ${r.parts + 1} parts)` : ""}`,
        minutes: r.minutes,
      }),
    );
    const classTotal = cls.reduce((x, s) => x + (dur(s) || 60), 0);
    for (const s of mine.filter((s) => s.type === "revision_video")) {
      revisions.push({ topicTitle: t.title as string, minutes: dur(s) || Math.round(classTotal * 0.25) || 30 });
    }
  }

  const miq: TopicMIQ[] = sorted.map((t) => ({ topicTitle: t.title as string, rev1: parseQs(t.important_qs_rev1 as string), rev2: parseQs(t.important_qs_rev2 as string) }));

  return {
    subjectTitle: subj.title as string,
    startDate: opts.startDate,
    examDate: opts.examDate,
    config,
    params: {
      start_months_before_exam: Number(subj.plan_start_months_before_exam) || 8,
      max_months: Number(subj.plan_max_months) || 5,
      target_months: Number(subj.plan_target_months) || 4,
    },
    classes,
    revisions,
    miq,
    topics: topicsMeta,
    doneClasses: opts.doneClasses,
  };
}
