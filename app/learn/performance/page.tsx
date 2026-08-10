import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import Help from "@/app/components/Help";
import { viaProxy } from "@/lib/fileProxy";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Performance — CA Parveen Sharma" };

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

  // --- Descriptive papers (the tests students actually sit) ---
  //
  // This page read `subjective_submissions` — the old in-page typed-answer
  // feature, which has never held a single row. The paper tests, where a
  // student downloads a question paper and uploads a handwritten answer book,
  // live in `descriptive_attempts` and were never read here at all. So a
  // student could sit a paper, be marked, have it released by the examiner,
  // and still be told they had attempted nothing.
  const { data: myPapers } = await svc
    .from("descriptive_attempts")
    .select("id, section_id, status, review_status, awarded_marks, total_marks, annotated_url, submitted_at, examiner_remarks, report")
    .eq("student_id", user.id)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false });

  const paperSectionIds = [...new Set((myPapers ?? []).map((a) => a.section_id as string))];
  // Everyone else's marks on the same papers, for the rank line. Only RELEASED
  // copies count — a mark an examiner has not yet approved is not a mark.
  const { data: allPapers } = paperSectionIds.length
    ? await svc
        .from("descriptive_attempts")
        .select("section_id, awarded_marks, total_marks, student_id")
        .in("section_id", paperSectionIds)
        .eq("review_status", "checked")
        .not("awarded_marks", "is", null)
    : { data: [] as any[] };

  // section titles
  const allSectionIds = [...new Set([...mcqSectionIds, ...paperSectionIds, ...(questions ?? []).map((q) => q.section_id)])];
  const { data: sections } = allSectionIds.length
    ? await svc.from("sections").select("id, title, topic_id, topics(title)").in("id", allSectionIds)
    : { data: [] as any[] };
  const secTitle = new Map((sections ?? []).map((s) => [s.id, s.title as string]));
  const secTopic = new Map(
    (sections ?? []).map((s) => [
      s.id,
      { topicId: (s as any).topic_id as string | null, topicTitle: ((s as any).topics?.title as string) ?? "this topic" },
    ]),
  );
  const qById = new Map((questions ?? []).map((q) => [q.id, q]));

  // "Rewatch" link to the topic's class videos for a given section.
  function rewatch(sectionId: string | null | undefined) {
    if (!sectionId) return null;
    const t = secTopic.get(sectionId);
    if (!t?.topicId) return null;
    return (
      <Link href={`/learn/topic/${t.topicId}`} style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".85rem" }}>
        📺 Rewatch the classes for {t.topicTitle} →
      </Link>
    );
  }

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

  const hasAny = (myMcq?.length ?? 0) > 0 || (mySubj?.length ?? 0) > 0 || (myPapers?.length ?? 0) > 0;

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
        <p className="crumb"><Link prefetch={false} href="/dashboard">← Dashboard</Link></p>
        <div className="learn-hero">
          <span className="badge">📊 Performance</span>
          <h1>My performance <Help text="Your saved test scores and feedback. 'Better than X% of students' shows your rank among everyone who took the same test. The 'Rewatch' links take you to the classes for topics you got wrong." /></h1>
          <p className="meta">Your test scores, feedback and where you stand among other students.</p>
        </div>

        {!hasAny && (
          <div className="card" style={{ marginTop: 22 }}>
            <p className="muted">You haven&apos;t attempted any tests yet. Take an MCQ or a descriptive test and your marks, your rank and your checked copy appear here. ✨</p>
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
                    {wrong > 0 && <div style={{ marginTop: 6 }}>{rewatch(sid)}</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Descriptive papers */}
        {(myPapers?.length ?? 0) > 0 && (
          <>
            <h2 style={{ marginTop: 28, fontSize: "1.15rem" }}>✍️ Descriptive tests</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {(myPapers ?? []).map((a) => {
                const sid = a.section_id as string;
                const released = a.review_status === "checked" && a.awarded_marks != null;
                const awarded = Number(a.awarded_marks);
                const total = Number(a.total_marks) || 20;
                // Rank against everyone else's RELEASED mark on the same paper,
                // best attempt per student.
                const byStudent = new Map<string, number>();
                for (const x of allPapers ?? []) {
                  if (x.section_id !== sid) continue;
                  const r = Number(x.awarded_marks) / Math.max(1, Number(x.total_marks) || 20);
                  const cur = byStudent.get(x.student_id as string);
                  if (cur === undefined || r > cur) byStudent.set(x.student_id as string, r);
                }
                const ratios = [...byStudent.values()];
                const pct = released ? percentile(ratios, awarded / Math.max(1, total)) : null;
                const report = a.report as { summary?: string; concepts_to_revise?: string[] } | null;

                return (
                  <div className="card" key={a.id as string}>
                    <strong>{secTitle.get(sid) ?? "Descriptive test"}</strong>

                    {released ? (
                      <>
                        <div className="muted" style={{ fontSize: ".88rem", marginTop: 4 }}>
                          Marks: <strong>{awarded}/{total}</strong> ({Math.round((awarded / Math.max(1, total)) * 100)}%)
                          {a.submitted_at ? ` · submitted ${new Date(a.submitted_at as string).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                        </div>
                        {pct !== null && ratios.length > 1 && (
                          <div style={{ marginTop: 6, fontWeight: 700, color: "var(--accent)" }}>
                            🏅 Better than {pct}% of students ({ratios.length} sat it)
                          </div>
                        )}
                        {report?.summary && (
                          <p style={{ marginTop: 8, fontSize: ".9rem" }}>{report.summary}</p>
                        )}
                        {a.examiner_remarks && (
                          <p style={{ marginTop: 6, fontSize: ".9rem" }}>
                            <strong>Faculty:</strong> {a.examiner_remarks as string}
                          </p>
                        )}
                        {(report?.concepts_to_revise ?? []).length > 0 && (
                          <p className="muted" style={{ marginTop: 6, fontSize: ".85rem" }}>
                            <strong>Revise:</strong> {(report!.concepts_to_revise ?? []).join(" · ")}
                          </p>
                        )}
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                          {a.annotated_url && (
                            <a className="btn small" href={viaProxy(a.annotated_url as string)} target="_blank" rel="noopener noreferrer">
                              📝 My checked copy + official answers
                            </a>
                          )}
                          {rewatch(sid)}
                        </div>
                      </>
                    ) : (
                      // The mark exists but the faculty has not released it. It is
                      // not shown, and it is not hinted at either.
                      <div className="muted" style={{ fontSize: ".88rem", marginTop: 4 }}>
                        ⏳ Your copy is under review by the faculty. Your marks and your checked copy appear here as
                        soon as it is released.
                        {a.submitted_at ? ` Submitted ${new Date(a.submitted_at as string).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.` : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* The old in-page typed-answer questions. Kept for any historic row;
            renamed so it cannot be mistaken for the paper tests again. */}
        {(mySubj?.length ?? 0) > 0 && (
          <>
            <h2 style={{ marginTop: 28, fontSize: "1.15rem" }}>✍️ Written answers</h2>
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
                    {typeof s.ai_score === "number" && s.ai_score < mm && (
                      <div style={{ marginTop: 6 }}>{rewatch(q?.section_id)}</div>
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
