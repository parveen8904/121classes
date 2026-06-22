import { createServiceClient } from "@/lib/supabase/service";
import type { PlanInput, ClassItem, RevItem, TopicMIQ } from "./engine";

function parseQs(t: string | null | undefined): string[] {
  return (t ?? "").split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
}
function impRank(imp: unknown): number {
  const v = imp && typeof imp === "object" ? (Object.values(imp as Record<string, unknown>)[0] as string) : null;
  const m: Record<string, number> = { A: 1, B: 2, C: 3 };
  return m[String(v ?? "").toUpperCase()] ?? 4;
}
const dur = (cfg: any) => Number(cfg?.duration_minutes) || 0;
const classNo = (cfg: any) => Number(cfg?.topic_class_no ?? cfg?.class_no ?? 0);

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
  for (const t of sorted) {
    const mine = secs.filter((s) => s.topic_id === t.id);
    const cls = mine.filter((s) => s.type === "full_class_video").sort((a, b) => classNo(a.config) - classNo(b.config));
    cls.forEach((s, i) => classes.push({ topicTitle: t.title as string, label: `Class ${classNo(s.config) || i + 1}`, minutes: dur(s.config) || 60 }));
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
    doneClasses: opts.doneClasses,
  };
}
