import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Performance — 121 CA Classes" };

// Percentile: how many scored <= me, as a %. "Better than X% of students."
function percentile(values: number[], mine: number): number {
  if (values.length <= 1) return 100;
  const atOrBelow = values.filter((v) => v <= mine).length;
  return Math.round((atOrBelow / values.length) * 100);
}

export default async function PerformancePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/learn/performance");

  const svc = createServiceClient();

  // --- MCQ ---
  const { data: myMcq } = await svc
    .from("mcq_attempts")
    .select("section_id, score, total, created_at")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });
  const mcqSectionIds = [...new Set((myMcq ?? []).map((a) => a.section_id))];

  const { data: allMcq } = mcqSectionIds.length
    ? await svc.from("mcq_attempts").select("section_id, score, total, student_id").in("section_id", mcqSectionIds)
    : { data: [] as any[] };

  // --- Subjective ---
  const { data: mySubj } = await svc
    .from("subjective_submissions")
    .select("question_id, ai_score, ai_feedback, status, created_at")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });
  const qIds = [...new Set((mySubj ?? []).map((s) => s.question_id))];
  const { data: questions } = qIds.length
    ? await svc.from("subjective_questions").select("id, prompt, max_marks, section_id").in("id", qIds)
    : { data: [] as any[] };
  const { data: allSubj } = qIds.length
    ? await svc.from("subjective_submissions").select("question_id, ai_score, student_id").in("question_id", qIds)
    : { data: [] as any[] };

  // section titles
  const allSectionIds = [...new Set([...mcqSectionIds, ...(questions ?? []).map((q) => q.section_id)])];
  const { data: sections } = allSectionIds.length
    ? await svc.from("sections").select("id, title").in("id", allSectionIds)
    : { data: [] as any[] };
  const secTitle = new Map((sections ?? []).map((s) => [s.id, s.title as string]));
  const qById = new Map((questions ?? []).map((q) => [q.id, q]));

  // Best MCQ attempt per section (mine), with rank.
  const bestMine = new Map<string, { score: number; total: number }>();
  for (const a of myMcq ?? []) {
    const cur = bestMine.get(a.section_id);
    if (!cur || a.score / Math.max(1, a.total) > cur.score / Math.max(1, cur.total)) {
      bestMine.set(a.section_id, { score: a.score, total: a.total });
    }
  }
  // best ratio per student per section, for ranking
  function sectionRatios(sectionId: string): number[] {
    const byStudent = new Map<string, number>();
    for (const a of allMcq ?? []) {
      if (a.section_id !== sectionId) continue;
      const r = a.score / Math.max(1, a.total);
      const cur = byStudent.get(a.student_id);
      if (cur === undefined || r > cur) byStudent.set(a.student_id, r);
    }
    return [...byStudent.values()];
  }

  const hasAny = (myMcq?.length ?? 0) > 0 || (mySubj?.length ?? 0) > 0;

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
        <div className="learn-hero">
          <span className="badge">📊 Performance</span>
          <h1>My performance</h1>
          <p className="meta">Your test scores, feedback and where you stand among other students.</p>
        </div>

        {!hasAny && (
          <div className="card" style={{ marginTop: 22 }}>
            <p className="muted">You haven&apos;t attempted any tests yet. Take an MCQ or descriptive test to see your performance here. ✨</p>
          </div>
        )}

        {/* MCQ */}
        {[...bestMine.entries()].length > 0 && (
          <>
            <h2 style={{ marginTop: 28, fontSize: "1.15rem" }}>🧠 MCQ tests</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {[...bestMine.entries()].map(([sid, best]) => {
                const ratios = sectionRatios(sid);
                const myRatio = best.score / Math.max(1, best.total);
                const pct = percentile(ratios, myRatio);
                const wrong = best.total - best.score;
                return (
                  <div className="card" key={sid}>
                    <strong>{secTitle.get(sid) ?? "Test"}</strong>
                    <div className="muted" style={{ fontSize: ".88rem", marginTop: 4 }}>
                      Score: <strong>{best.score}/{best.total}</strong> · ✅ {best.score} right · ❌ {wrong} wrong
                    </div>
                    <div style={{ marginTop: 6, fontWeight: 700, color: "var(--accent)" }}>
                      🏅 Better than {pct}% of students{ratios.length > 1 ? ` (${ratios.length} took it)` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Subjective */}
        {(mySubj?.length ?? 0) > 0 && (
          <>
            <h2 style={{ marginTop: 28, fontSize: "1.15rem" }}>✍️ Descriptive tests</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {(mySubj ?? []).map((s, i) => {
                const q = qById.get(s.question_id) as { prompt?: string; max_marks?: number; section_id?: string } | undefined;
                const mm = q?.max_marks ?? 10;
                const scores = (allSubj ?? [])
                  .filter((x) => x.question_id === s.question_id && typeof x.ai_score === "number")
                  .map((x) => x.ai_score as number);
                const pct = typeof s.ai_score === "number" ? percentile(scores, s.ai_score) : null;
                return (
                  <div className="card" key={i}>
                    <strong>{q?.prompt?.slice(0, 100) || "Question"}{(q?.prompt?.length ?? 0) > 100 ? "…" : ""}</strong>
                    <div className="muted" style={{ fontSize: ".88rem", marginTop: 4 }}>
                      {typeof s.ai_score === "number" ? <>Score: <strong>{s.ai_score}/{mm}</strong></> : `Status: ${s.status}`}
                      {pct !== null && scores.length > 1 && <> · 🏅 Better than {pct}% of students</>}
                    </div>
                    {s.ai_feedback && (
                      <p style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: ".9rem" }}>{s.ai_feedback}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
