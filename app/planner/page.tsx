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

  // Syllabus checklist for our students (published topics).
  const { data: topics } = await svc
    .from("topics")
    .select("id, title, order_index, subject_id, subjects(title)")
    .eq("is_published", true)
    .order("order_index")
    .limit(400);

  const items: PlanItem[] = (topics ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    subjectId: (t as { subject_id?: string | null }).subject_id ?? null,
    subject: (t as { subjects?: { title?: string } | null }).subjects?.title ?? "General",
  }));

  // Per-class durations (admin-set, key dur:<topicId>), aligned to items order.
  const { data: durRows } = await supabase.from("site_settings").select("key, value").like("key", "dur:%");
  const durMap = new Map((durRows ?? []).map((r) => [(r.key as string).slice(4), Number(r.value) || 0]));
  const durations = items.map((i) => durMap.get(i.id) || 0);

  // Question lists from the AI repository (per subject). master = important_qs,
  // revision = revision_qs. Count is the number of non-empty lines of content.
  const today = new Date().toISOString().slice(0, 10);
  const { data: qItems } = await svc
    .from("repository_items")
    .select("kind, subject_id, content, valid_from, valid_to, is_active")
    .in("kind", ["important_qs", "revision_qs"])
    .eq("is_active", true);
  const { data: subjRows } = await svc.from("subjects").select("id, title");
  const subjTitle = new Map((subjRows ?? []).map((s) => [s.id, s.title as string]));

  const subjectMaster: Record<string, number> = {};
  const subjectRev: Record<string, number> = {};
  for (const it of qItems ?? []) {
    if (it.valid_from && it.valid_from > today) continue;
    if (it.valid_to && it.valid_to < today) continue;
    const title = it.subject_id ? subjTitle.get(it.subject_id) : null;
    if (!title || !it.content) continue;
    const count = String(it.content).split("\n").map((s) => s.trim()).filter(Boolean).length;
    const bucket = it.kind === "important_qs" ? subjectMaster : subjectRev;
    bucket[title] = (bucket[title] || 0) + count;
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
