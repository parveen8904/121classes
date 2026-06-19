import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import Planner, { type PlanItem } from "./Planner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Study Planner — 121 CA Classes" };

export default async function PlannerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/planner");

  const { data: prof } = await supabase.from("profiles").select("target_attempt").eq("id", user.id).maybeSingle();
  const targetAttempt = String(prof?.target_attempt || "").replace(/_/g, " ");

  const { data: plan } = await supabase.from("study_plans").select("setup, schedule, remind").eq("user_id", user.id).maybeSingle();
  const initial = plan ? { setup: plan.setup, schedule: plan.schedule, remind: plan.remind } : null;

  const { data: cfgRow } = await supabase.from("site_settings").select("value").eq("key", "planner_config").maybeSingle();
  let config: Record<string, number> = {};
  try { config = JSON.parse((cfgRow?.value as string) || "{}"); } catch {}

  const svc = createServiceClient();

  // Syllabus checklist for our students — published, regular topics (the
  // combined topic is a subject-wide bundle, not a study unit).
  const { data: topics } = await svc
    .from("topics")
    .select("id, title, order_index, subject_id, importance, weightage_marks, important_qs_rev1, important_qs_rev2, subjects(title)")
    .eq("is_published", true)
    .eq("is_combined", false)
    .order("order_index")
    .limit(400);

  // Order by the hit list for the student's attempt (A→B→C); within the same
  // category, heavier (higher ICAI weightage) topics come first so they get
  // studied sooner and more revision runway. Falls back to exhaustive order.
  const normAtt = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();
  const catRank = (imp: Record<string, string> | null | undefined) => {
    if (!imp) return 9;
    const hit = Object.entries(imp).find(([a]) => normAtt(a) === normAtt(targetAttempt));
    const c = hit?.[1]?.toUpperCase();
    return c === "A" ? 0 : c === "B" ? 1 : c === "C" ? 2 : c ? 3 : 9;
  };
  const ordered = [...(topics ?? [])]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const r = catRank(a.t.importance as Record<string, string>) - catRank(b.t.importance as Record<string, string>);
      if (r !== 0) return r;
      const w = (Number(b.t.weightage_marks) || 0) - (Number(a.t.weightage_marks) || 0);
      if (w !== 0) return w;
      return a.i - b.i;
    })
    .map((x) => x.t);

  const items: PlanItem[] = ordered.map((t) => ({
    id: t.id,
    title: t.title,
    subjectId: (t as { subject_id?: string | null }).subject_id ?? null,
    subject: (t as { subjects?: { title?: string } | null }).subjects?.title ?? "General",
  }));

  // Per-topic durations + important-question counts come from the classes
  // (sections) and the topic's revision question lists.
  const topicIds = items.map((i) => i.id);
  const { data: secRows } = topicIds.length
    ? await svc.from("sections").select("topic_id, config").in("topic_id", topicIds).eq("is_published", true)
    : { data: [] as { topic_id: string; config: Record<string, unknown> | null }[] };
  const lineCount = (v: unknown) => (v ? String(v).split("\n").map((s) => s.trim()).filter(Boolean).length : 0);

  const durByTopic = new Map<string, number>();
  const importantQByTopic = new Map<string, number>();
  for (const s of secRows ?? []) {
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    durByTopic.set(s.topic_id, (durByTopic.get(s.topic_id) || 0) + (Number(cfg.duration_minutes) || 0));
    importantQByTopic.set(s.topic_id, (importantQByTopic.get(s.topic_id) || 0) + lineCount(cfg.important_questions));
  }
  const durations = items.map((i) => durByTopic.get(i.id) || 0);

  // Master Qs (exhaustive) = questions discussed in the classes; first-revision
  // Qs = the topic's first-revision important-question list. Aggregated by
  // subject for the planner's distribution.
  const subjectMaster: Record<string, number> = {};
  const subjectRev: Record<string, number> = {};
  for (const t of topics ?? []) {
    const subj = (t as { subjects?: { title?: string } | null }).subjects?.title ?? "General";
    subjectMaster[subj] = (subjectMaster[subj] || 0) + (importantQByTopic.get(t.id) || 0);
    subjectRev[subj] = (subjectRev[subj] || 0) + lineCount((t as { important_qs_rev1?: string }).important_qs_rev1);
  }

  // Student test performance (avg MCQ score %) — feeds the pace column.
  const { data: myMcq } = await svc.from("mcq_attempts").select("score, total").eq("student_id", user.id);
  let testPerf = -1; // -1 = no tests yet
  const scored = (myMcq ?? []).filter((a) => (a.total ?? 0) > 0);
  if (scored.length) {
    const ratio = scored.reduce((s, a) => s + (a.score ?? 0) / (a.total as number), 0) / scored.length;
    testPerf = Math.round(ratio * 100);
  }

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 920 }}>
      <div className="learn-hero" style={{ marginBottom: 18 }}>
        <span className="badge">🗓️ Study Planner</span>
        <h1>Study planner &amp; diary</h1>
        <p className="meta">
          Tell us your exam date and how you&apos;re studying — we&apos;ll build a day-by-day plan in stages
          (study, first revision, and a last revision of your must-do questions in the final 5 days) with tests and mock exams so you finish on time
          {targetAttempt ? ` for ${targetAttempt}` : ""}. ✍️
        </p>
      </div>
      <Planner
        items={items}
        signedIn={!!user}
        initial={initial as never}
        config={config as never}
        durations={durations}
        subjectMaster={subjectMaster}
        subjectRev={subjectRev}
        testPerf={testPerf}
      />
    </section>
  );
}
