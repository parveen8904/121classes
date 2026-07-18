import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import CaseText, { tidyAmounts } from "@/app/components/CaseText";
import { caseDisplayNumbers } from "@/lib/caseOrder";
import { submitCaseAttempt } from "../actions";

export const dynamic = "force-dynamic";

type Q = { id: string; seq: number; question: string; options: string[]; correct_index: number; explanation: { why_correct?: string; why_options?: string[] } | null };

// One case study: the scenario, its MCQs, and (after submitting) the results —
// right/wrong per question, the correct answer, and the AI-generated reasons.
export default async function CasePage(
  props: {
    params: Promise<{ setId: string; caseId: string }>;
    searchParams: Promise<{ attempt?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/cases/${params.setId}/${params.caseId}`);

  const svc = createServiceClient();
  const [{ data: set }, { data: cs }, { data: me }] = await Promise.all([
    svc.from("case_sets").select("id, title, status, is_published").eq("id", params.setId).maybeSingle(),
    svc.from("case_studies").select("id, seq, title, scenario, set_id").eq("id", params.caseId).maybeSingle(),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);
  const isStaff = me?.role === "admin" || me?.role === "faculty";
  if (!set || !cs || cs.set_id !== set.id || set.status !== "ready" || (!set.is_published && !isStaff)) notFound();

  // Free-plan quota: a new case beyond the allowance shows an Enroll screen.
  if (!isStaff) {
    const { checkQuota } = await import("@/lib/entitlements");
    const quota = await checkQuota(user.id, "case_study", cs.id as string);
    if (!quota.allowed) {
      const { data: setSub } = await svc.from("case_sets").select("subject_id, subjects(course_id)").eq("id", set.id).maybeSingle();
      const courseId = (setSub?.subjects as { course_id?: string } | null)?.course_id ?? "";
      const UpgradeGate = (await import("@/app/components/UpgradeGate")).default;
      return (
        <UpgradeGate
          title="case scenarios"
          used={quota.used}
          limit={quota.limit}
          plansHref={courseId ? `/learn/${courseId}/plans?subject=${setSub?.subject_id ?? ""}` : "/dashboard"}
          backHref={`/learn/cases/${set.id}`}
          backLabel="← Back to cases"
        />
      );
    }
  }

  const { data: qRows } = await svc
    .from("case_questions")
    .select("id, seq, question, options, correct_index, explanation")
    .eq("case_id", cs.id)
    .order("seq");
  const questions = (qRows ?? []) as Q[];

  // Same scrambled number the list page shows (deterministic from the id).
  const { data: sibCases } = await svc.from("case_studies").select("id").eq("set_id", set.id);
  const caseNo = caseDisplayNumbers((sibCases ?? []) as { id: string }[]).get(cs.id as string) ?? cs.seq;

  // Results mode: show the attempt the student was just redirected to.
  let attempt: { answers: Record<string, number>; score: number; total: number } | null = null;
  if (searchParams.attempt) {
    const { data: at } = await svc
      .from("case_attempts")
      .select("answers, score, total, student_id")
      .eq("id", searchParams.attempt)
      .maybeSingle();
    if (at && at.student_id === user.id) attempt = at as unknown as { answers: Record<string, number>; score: number; total: number };
  }
  const letters = ["A", "B", "C", "D", "E", "F"];

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
        <p className="crumb"><Link href={`/learn/cases/${set.id}`}>← {set.title}</Link></p>
        <div className="learn-hero">
          <span className="badge">🧩 Case study</span>
          <h1 style={{ fontSize: "1.5rem" }}>Case Scenario {caseNo}</h1>
          {attempt && (
            <p className="meta" style={{ fontWeight: 800, fontSize: "1.05rem", color: attempt.score === attempt.total ? "#16a34a" : "var(--accent)" }}>
              Your score: {attempt.score} / {attempt.total} {attempt.score === attempt.total ? "🎉 Perfect!" : ""}
            </p>
          )}
        </div>

        {/* The scenario — typeset (tables, bullets, tight ₹ amounts) */}
        <div className="card" style={{ marginTop: 16 }}>
          <strong>📖 Read the case</strong>
          <CaseText text={cs.scenario} />
        </div>

        {!attempt ? (
          // ---- Answer mode ----
          (<form action={submitCaseAttempt} style={{ marginTop: 18 }}>
            <input type="hidden" name="setId" value={set.id} />
            <input type="hidden" name="caseId" value={cs.id} />
            <div style={{ display: "grid", gap: 14 }}>
              {questions.map((q, qi) => (
                <div className="card" key={q.id}>
                  <strong>Q{qi + 1}. {tidyAmounts(q.question)}</strong>
                  <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                    {q.options.map((opt, oi) => (
                      <label key={oi} className="mcq-opt" style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "8px 12px" }}>
                        <input type="radio" name={`q_${q.id}`} value={oi} required style={{ marginTop: 3 }} />
                        <span><strong>{letters[oi] ?? oi + 1}.</strong> {tidyAmounts(opt)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <SubmitButton className="btn" style={{ marginTop: 16 }}>Submit answers → see results &amp; reasons</SubmitButton>
          </form>)
        ) : (
          // ---- Results mode ----
          (<div style={{ display: "grid", gap: 14, marginTop: 18 }}>
            {questions.map((q, qi) => {
              const picked = attempt!.answers[q.id] ?? -1;
              const right = picked === q.correct_index;
              const ex = q.explanation ?? null;
              return (
                <div className="card" key={q.id} style={{ borderLeft: `4px solid ${right ? "#16a34a" : "#b91c1c"}` }}>
                  <strong>{right ? "✅" : "❌"} Q{qi + 1}. {tidyAmounts(q.question)}</strong>
                  <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                    {q.options.map((opt, oi) => {
                      const isCorrect = oi === q.correct_index;
                      const isPicked = oi === picked;
                      return (
                        <div key={oi} style={{
                          background: isCorrect ? "rgba(34,197,94,.12)" : isPicked ? "rgba(239,68,68,.10)" : "var(--bg-soft)",
                          border: isCorrect ? "1px solid #16a34a" : isPicked ? "1px solid #ef4444" : "1px solid transparent",
                          borderRadius: 8, padding: "8px 12px",
                        }}>
                          <span><strong>{letters[oi] ?? oi + 1}.</strong> {tidyAmounts(opt)}
                            {isCorrect && <strong style={{ color: "#16a34a" }}> ✓ correct answer</strong>}
                            {isPicked && !isCorrect && <strong style={{ color: "#b91c1c" }}> ✗ your answer</strong>}
                          </span>
                          {ex?.why_options?.[oi] && (
                            <p className="muted" style={{ fontSize: ".84rem", margin: "4px 0 0" }}>{ex.why_options[oi]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {ex?.why_correct && (
                    <p style={{ marginTop: 10, background: "rgba(13,148,136,.08)", borderRadius: 8, padding: "8px 12px", fontSize: ".9rem" }}>
                      💡 <strong>Why:</strong> {ex.why_correct}
                    </p>
                  )}
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link className="btn secondary" href={`/learn/cases/${set.id}/${cs.id}`}>🔁 Try this case again</Link>
              <Link className="btn" href={`/learn/cases/${set.id}`}>Next case →</Link>
            </div>
          </div>)
        )}
      </section>
    </main>
  );
}
