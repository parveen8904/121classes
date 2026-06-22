import { createServiceClient } from "@/lib/supabase/service";
import type { PlanInput, ClassItem, RevItem, TopicMIQ, TopicMeta, Scope } from "./engine";

// The saved study_plans.setup shape.
export type PlanSetup = {
  subjectId: string; startDate: string; examDate: string; speed: number; doneClasses: number;
  revisions?: number; exhaustiveScope?: Scope; pickedTopicIds?: string[];
  revScope1?: Exclude<Scope, "skip">; revScope2?: Exclude<Scope, "skip">;
  stageDays?: { exhaustive?: number; rr1?: number; rr2?: number; rr3?: number };
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
const dur = (cfg: any) => Number(cfg?.duration_minutes) || 0;
// Use the FINAL (continuous) class number, not the within-topic number.
const classNo = (cfg: any) => Number(cfg?.class_no ?? cfg?.topic_class_no ?? 0);

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

  const sorted = (topics ?? []).slice().sort((a, b) => impRank(a.importance) - impRank(b.importance) || ((a.order_index ?? 0) - (b.order_index ?? 0)));
  const topicIds = sorted.map((t) => t.id as string);

  const secs = topicIds.length
    ? (await svc.from("sections").select("topic_id, type, config").in("topic_id", topicIds).eq("is_published", true)).data ?? []
    : [];

  const classes: ClassItem[] = [];
  const revisions: RevItem[] = [];
  const topicsMeta: TopicMeta[] = sorted.map((t) => ({ topicId: t.id as string, title: t.title as string, importance: impLetter(t.importance) }));
  for (const t of sorted) {
    const mine = secs.filter((s) => s.topic_id === t.id);
    const cls = mine.filter((s) => s.type === "full_class_video").sort((a, b) => classNo(a.config) - classNo(b.config));
    cls.forEach((s, i) => classes.push({ topicId: t.id as string, topicTitle: t.title as string, importance: impLetter(t.importance), label: `Class ${classNo(s.config) || i + 1}`, minutes: dur(s.config) || 60 }));
    const classTotal = cls.reduce((x, s) => x + (dur(s.config) || 60), 0);
    for (const s of mine.filter((s) => s.type === "revision_video")) {
      revisions.push({ topicTitle: t.title as string, minutes: dur(s.config) || Math.round(classTotal * 0.25) || 30 });
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
