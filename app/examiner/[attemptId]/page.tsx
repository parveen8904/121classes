import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveFileUrl } from "@/lib/storage";
import PdfUpload from "@/app/admin/_components/PdfUpload";
import { submitCheck, unclaimCopy, saveExaminerCopy } from "../actions";
import SubmitButton from "@/app/components/SubmitButton";
import type { DescriptiveGrade } from "@/lib/ai";
import AnswerKey from "@/app/components/AnswerKey";

export const dynamic = "force-dynamic";

// One copy on the examiner's table: the question paper, the student's answer
// book, the AI-checked report and annotated copy — verify, adjust marks if
// needed, and release to the student.
export default async function ExaminerCopy(props: { params: Promise<{ attemptId: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/examiner");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "faculty") redirect("/dashboard");

  const svc = createServiceClient();
  const { data: row } = await svc
    .from("descriptive_attempts")
    .select("*")
    .eq("id", params.attemptId)
    .maybeSingle();
  if (!row) notFound();

  const [{ data: section }, { data: student }] = await Promise.all([
    svc.from("sections").select("title, topic_id, config").eq("id", row.section_id).maybeSingle(),
    svc.from("profiles").select("full_name, email").eq("id", row.student_id).maybeSingle(),
  ]);
  const cfg = ((section?.config ?? {}) as Record<string, string>);
  const { data: topic } = section
    ? await svc.from("topics").select("title, subjects(title)").eq("id", section.topic_id).maybeSingle()
    : { data: null };

  const alreadyMarkedFlag = (row as { review_flag?: string | null }).review_flag === "may_already_be_marked";

  const [answerUrl, annotatedUrl, questionUrl, solutionUrl] = await Promise.all([
    resolveFileUrl(row.file_url, 3600),
    resolveFileUrl(row.annotated_url, 3600),
    resolveFileUrl(cfg.paper_question_pdf, 3600),
    resolveFileUrl(cfg.paper_solution_pdf, 3600),
  ]);

  // The official answers and the marking scheme an examiner needs in order to
  // check anything. Five tests had their "solution PDF" detached (they were
  // scanned student copies), so a PDF link alone left the examiner with
  // nothing to check against.
  const [{ data: keyRow }, { data: schemeRow }] = await Promise.all([
    svc.from("item_solutions").select("solution_md, status").eq("section_id", row.section_id).maybeSingle(),
    svc.from("marking_schemes").select("scheme").eq("section_id", row.section_id).maybeSingle(),
  ]);
  const officialKey = keyRow?.status === "approved" ? String(keyRow.solution_md ?? "") : "";
  const markingScheme = schemeRow?.scheme ? String(schemeRow.scheme) : "";

  const report = (row.report ?? null) as DescriptiveGrade | null;
  const beingCheckedByOther = row.review_status === "checking" && row.examiner_id && row.examiner_id !== user.id && me?.role !== "admin";
  const checked = row.review_status === "checked";

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
        <p className="crumb"><Link href="/examiner">← Examiner desk</Link></p>
        <span className="badge">🧑‍🏫 Checking copy</span>
        <h1 style={{ margin: "12px 0 4px", fontSize: "1.5rem" }}>{section?.title ?? "Descriptive test"}</h1>
        <p className="muted">
          🧑‍🎓 <strong>{student?.full_name || student?.email || "Student"}</strong>
          {" · "}📚 {(topic as { subjects?: { title?: string } } | null)?.subjects?.title ?? "—"} · 📖 {(topic as { title?: string } | null)?.title ?? "—"}
          {row.submitted_at ? ` · submitted ${new Date(row.submitted_at).toLocaleString("en-IN")}` : ""}
        </p>

        {beingCheckedByOther && (
          <div className="notice" style={{ margin: "12px 0", border: "2px solid #f59e0b", borderRadius: 10, padding: "10px 14px" }}>
            🔍 This copy is being checked by <strong>{row.examiner_name ?? "another examiner"}</strong> — view only.
          </div>
        )}
        {checked && (
          <div className="notice ok" style={{ margin: "12px 0" }}>
            ✅ Checked by <strong>{row.examiner_name}</strong>
            {row.examiner_checked_at ? ` on ${new Date(row.examiner_checked_at).toLocaleString("en-IN")}` : ""} — already released to the student.
          </div>
        )}

        {/* The documents */}
        {alreadyMarkedFlag && (
          <div className="notice" style={{ background: "rgba(234,179,8,.12)", marginTop: 12 }}>
            ⚠️ This answer book looked as though it may ALREADY carry marking from an earlier evaluation — marks,
            a total, a remark or a signature. It has been marked anyway; please glance at it before releasing, and
            ignore this if the copy is clean. The check is advisory and it does get this wrong.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
          {answerUrl && <a className="btn" href={answerUrl} target="_blank" rel="noopener noreferrer">📓 Student&apos;s answer book</a>}
          {questionUrl && <a className="btn secondary" href={questionUrl} target="_blank" rel="noopener noreferrer">❓ Question paper</a>}
          {solutionUrl && <a className="btn secondary" href={solutionUrl} target="_blank" rel="noopener noreferrer">✅ Suggested answers</a>}
          {annotatedUrl && <a className="btn secondary" href={annotatedUrl} target="_blank" rel="noopener noreferrer">🤖 AI-checked copy (annotated)</a>}
        </div>

        {(officialKey || markingScheme) && (
          <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            {officialKey && (
              <details className="card">
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>✅ Official answers (approved key)</summary>
                <AnswerKey text={officialKey} size=".8rem" />
              </details>
            )}
            {markingScheme && (
              <details className="card">
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>📏 Step marking guide — how the marks were awarded</summary>
                <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>
                  Built once from the official answers and used for every student on this test, so two copies with
                  the same working get the same marks.
                </p>
                <AnswerKey text={markingScheme} size=".8rem" />
              </details>
            )}
          </div>
        )}

        {/* AI report */}
        {report ? (
          <div className="card" style={{ marginTop: 8 }}>
            <strong>🤖 AI evaluation — {row.awarded_marks}{row.total_marks ? ` / ${row.total_marks}` : ""}</strong>
            {report.summary && <p style={{ marginTop: 8 }}>{report.summary}</p>}
            {(report.per_question ?? []).length > 0 && (
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <tbody>
                    <tr>
                      {["Question", "Marks", "Comment"].map((h) => (
                        <td key={h} style={{ border: "1px solid var(--border)", padding: "6px 10px", fontWeight: 700, background: "var(--bg-soft)" }}>{h}</td>
                      ))}
                    </tr>
                    {report.per_question.map((q, i) => (
                      <tr key={i}>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 10px" }}>
                          {q.q}
                          {/* The step-by-step award. The question total is the
                              sum of these, so you can check the arithmetic
                              rather than take the mark on trust. */}
                          {(q.steps ?? []).length > 0 && (
                            <details style={{ marginTop: 4 }}>
                              <summary style={{ cursor: "pointer", fontSize: ".78rem", color: "var(--muted)" }}>
                                step marks ({q.steps!.length})
                              </summary>
                              <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: ".78rem", lineHeight: 1.6 }}>
                                {q.steps!.map((s, k) => (
                                  <li key={k} style={{ color: s.awarded >= s.max ? "#16a34a" : s.awarded > 0 ? "#b45309" : "#b91c1c" }}>
                                    {s.step} — <strong>{s.awarded}</strong> / {s.max}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 10px", whiteSpace: "nowrap", textAlign: "right" }}>{q.awarded} / {q.max}</td>
                        <td style={{ border: "1px solid var(--border)", padding: "6px 10px" }}>{q.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(report.improvements ?? []).length > 0 && (
              <p className="muted" style={{ marginTop: 10, fontSize: ".88rem" }}><strong>Improvements:</strong> {report.improvements.join(" · ")}</p>
            )}
          </div>
        ) : (
          <div className="card" style={{ marginTop: 8 }}>
            <p className="muted" style={{ margin: 0 }}>⏳ The AI hasn&apos;t produced a report for this copy (it may still be processing, or the solution PDF is missing). You can still check the answer book manually and award marks below.</p>
          </div>
        )}

        {/* Verification form */}
        {/* Two ways forward, said plainly: accept the AI's marking, or mark it
            yourself and send that instead. */}
        {!checked && !beingCheckedByOther && (
          <>
          <form action={saveExaminerCopy} className="form-card" style={{ marginTop: 16 }}>
            <input type="hidden" name="id" value={row.id} />
            <strong>🖍️ Prefer to check it yourself?</strong>
            <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 10px" }}>
              Download the student&apos;s answer book above, annotate it the way you normally would, and upload it
              here. Your copy replaces the AI&apos;s as the one the student receives. Releasing it is still the
              separate step below.
            </p>
            <PdfUpload name="annotated_url" folder="descriptive" label="Your annotated copy (PDF)" />
            <SubmitButton className="btn small secondary" savedLabel="Saved">💾 Save my annotated copy</SubmitButton>
          </form>

          <form action={submitCheck} className="form-card" style={{ marginTop: 16 }}>
            <input type="hidden" name="id" value={row.id} />
            <strong>🖊️ Your verification</strong>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr", marginTop: 12 }}>
              <div>
                <label htmlFor="ex-marks">Final marks{row.total_marks ? ` (out of ${row.total_marks})` : ""}</label>
                <input id="ex-marks" name="marks" type="number" step="0.5" min={0} max={row.total_marks ?? undefined} defaultValue={row.awarded_marks ?? ""} placeholder="e.g. 62" />
              </div>
              <div>
                <label htmlFor="ex-remarks">Remarks for the student (optional)</label>
                <input id="ex-remarks" name="remarks" defaultValue={row.examiner_remarks ?? ""} placeholder="e.g. Good presentation; work on working notes for Q3." />
              </div>
            </div>
            <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 12px" }}>
              Submitting releases the copy: the student immediately sees the marks, the checked copy (yours if you
              uploaded one, otherwise the AI&apos;s) and your remarks — and gets an email. The step marking guide is
              never sent to the student.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SubmitButton className="btn">✅ Good to go — release to the student</SubmitButton>
            </div>
          </form>
          </>
        )}
        {row.review_status === "checking" && row.examiner_id === user.id && (
          <form action={unclaimCopy} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={row.id} />
            <SubmitButton className="btn small secondary">↩ Put back — let another examiner take it</SubmitButton>
          </form>
        )}
      </section>
    </main>
  );
}
