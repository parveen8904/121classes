import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import AnswerKey from "@/app/components/AnswerKey";
import AdminHero from "../_components/AdminHero";
import { createSet, approvePaper, unapprovePaper, savePaper, uploadPaperFiles, removeUploadedPaper, createUploadedPaper, rereadUploadedPdfs } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock test papers — Admin" };

type Paper = {
  id: string; course: string; subject: string; attempt_label: string; paper_no: number;
  title: string; total_marks: number; duration_min: number;
  questions_md: string | null; answers_md: string | null;
  status: string; error: string | null; generated_at: string | null;
  paper_pdf_url: string | null; answers_pdf_url: string | null; source: string | null;
};

const LABEL: Record<string, { text: string; colour: string }> = {
  queued: { text: "⏳ Not drafted yet", colour: "var(--muted)" },
  drafting: { text: "✍️ Being drafted", colour: "#b45309" },
  questions_ready: { text: "📝 Questions written — answers next", colour: "#b45309" },
  drafted: { text: "📄 Drafted — read it", colour: "#2563eb" },
  approved: { text: "✅ Live for students", colour: "#16a34a" },
  failed: { text: "❌ Failed", colour: "#b91c1c" },
  halted: { text: "⛔ Stopped — costing money for nothing", colour: "#b91c1c" },
};

// Full mock papers, drafted then approved.
//
// The same rule as the answer keys: a paper reaches a student only when CA
// Parveen Sharma has read it and approved it. His name is on every question,
// and a wrong figure in a mock paper is worse than no mock paper — a student
// spends three hours on it and learns the wrong thing.
export default async function MockPapersPage(props: {
  searchParams: Promise<{ made?: string; restarted?: string; drafted?: string; approved?: string; pulled?: string; saved?: string; err?: string; uploaded?: string; removed?: string; reread?: string }>;
}) {
  await assertArea(null);
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const { data } = await svc.from("mock_papers").select("*").order("course").order("paper_no");
  const papers = (data ?? []) as Paper[];

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 960 }}>
      <AdminHero
        badge="📄 Mock test papers"
        title="Full 100-mark papers, in the ICAI pattern"
        subtitle="30 marks of case-scenario MCQs and 70 marks descriptive. Draft one here, or upload a paper you have written yourself — students get your file exactly as you made it. Nothing reaches a student until you approve it."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Add a paper that is his from the first keystroke — no AI drafting in
          it at all. The drafting above stays for when he wants it; this is the
          way in for a paper he has already written. */}
      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          📤 Add MY OWN paper (upload a PDF — nothing is written by AI)
        </summary>
        <form action={createUploadedPaper} style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <div><label>Title</label><input name="title" required placeholder="Mock Test Paper 1" /></div>
            <div><label>Course</label><input name="course" defaultValue="CA Final" /></div>
            <div><label>Subject</label><input name="subject" defaultValue="Financial Reporting" /></div>
            <div><label>Attempt</label><input name="attempt_label" defaultValue="September 2026" /></div>
            <div><label>Paper no.</label><input name="paper_no" type="number" defaultValue={1} min={1} /></div>
            <div><label>Total marks</label><input name="total_marks" type="number" defaultValue={100} /></div>
            <div><label>Minutes</label><input name="duration_min" type="number" defaultValue={180} /></div>
          </div>
          <label style={{ marginTop: 8, display: "block" }}>Question paper (PDF) — this is what students receive</label>
          <input type="file" name="paper_pdf" accept="application/pdf" required style={{ marginBottom: 10 }} />
          <label>Solutions (PDF) — optional, and never shown to students</label>
          <input type="file" name="answers_pdf" accept="application/pdf" style={{ marginBottom: 10 }} />
          <SubmitButton className="btn" savedLabel="Added">📤 Add this paper</SubmitButton>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 8 }}>
            It arrives as a draft. Read it, then approve it like any other — approving is still what puts it in front of a student.
          </p>
        </form>
      </details>

      {searchParams.made && <div className="notice ok" style={{ marginTop: 16 }}>✅ {searchParams.made} paper slot(s) created.</div>}
      {searchParams.reread && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ↻ Your {String(searchParams.reread).replace("+", " and ")} was read back out of the stored PDF — the text
          the marker uses now matches your own file.
        </div>
      )}
      {searchParams.restarted && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          Cleared. The next pass writes a completely new paper — about ten minutes for the questions, then the
          answers in three parts.
        </div>
      )}
      {searchParams.drafted && <div className="notice ok" style={{ marginTop: 16 }}>✅ Drafted. Read it below before approving.</div>}
      {searchParams.approved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Approved — it is live on the mock tests page.</div>}
      {searchParams.pulled && <div className="notice ok" style={{ marginTop: 16 }}>Taken off the site. Students can no longer open it.</div>}
      {searchParams.saved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Saved.</div>}
      {searchParams.err && <div className="notice err" style={{ marginTop: 16 }}>❌ {searchParams.err}</div>}

      {papers.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>Nothing here yet</strong>
          <p className="muted" style={{ fontSize: ".88rem", margin: "4px 0 10px" }}>
            Create the three CA Intermediate — Advanced Accounting papers for the September 2026 attempt, then
            upload your question paper and answer key onto each one.
          </p>
          <form action={createSet}>
            <SubmitButton className="btn" savedLabel="Created">➕ Create the September 2026 set</SubmitButton>
          </form>
        </div>
      )}


      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {papers.map((p) => {
          const st = LABEL[p.status] ?? LABEL.queued;
          return (
            <div className="card" key={p.id} style={{ borderLeft: `4px solid ${st.colour}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "1.02rem" }}>Paper {p.paper_no} — {p.course}, {p.subject}</strong>
                <span style={{ color: st.colour, fontWeight: 700, fontSize: ".82rem" }}>{st.text}</span>
                <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>
                  {p.attempt_label} · {p.total_marks} marks · {p.duration_min} min
                </span>
              </div>
              {p.error && <p className="notice err" style={{ fontSize: ".82rem", marginTop: 8 }}>{p.error}</p>}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {/* When the stored PDF and the text beside it have fallen out
                    of step — the text is what gets marked against. */}
                <form action={rereadUploadedPdfs}>
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton className="btn small secondary" savedLabel="Re-read">
                    ↻ Re-read my PDFs
                  </SubmitButton>
                </form>
                {p.status === "drafted" && (
                  <form action={approvePaper}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="btn small" savedLabel="Approved">✅ Approve &amp; publish</SubmitButton>
                  </form>
                )}
                {p.status === "approved" && (
                  <form action={unapprovePaper}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="btn small secondary" savedLabel="Pulled">↩︎ Take it off the site</SubmitButton>
                  </form>
                )}
              </div>

              {p.questions_md && (
                <>
                  {/* The paper as it will actually look. Reading 1,000 lines of
                      plain text tells you nothing about whether it works as an
                      exam; the PDF does. */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <a className="btn small" href={`/mock-tests/${p.id}/pdf`} target="_blank" rel="noopener noreferrer">
                      📄 See it as a printed paper (PDF)
                    </a>
                    {p.answers_md && (
                      <a className="btn small secondary" href={`/mock-tests/${p.id}/pdf?answers=1`} target="_blank" rel="noopener noreferrer">
                        ✅ Suggested answers (PDF)
                      </a>
                    )}
                  </div>

                  <details className="card" style={{ marginTop: 12, padding: 12 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 700 }}>📄 The question paper</summary>
                    <AnswerKey text={p.questions_md} size=".76rem" />
                  </details>
                  {p.answers_md && (
                    <details className="card" style={{ marginTop: 8, padding: 12 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>✅ The suggested answers</summary>
                      <AnswerKey text={p.answers_md} size=".76rem" />
                    </details>
                  )}
                  {/* HIS OWN PAPER. Uploading a question paper makes students
                      see that exact file — his layout, untouched. The solutions
                      file is private: it feeds the checking and is never served
                      to a student. */}
                  <details style={{ marginTop: 8 }} open={p.source === "uploaded"}>
                    <summary className="btn as-btn small" style={{ cursor: "pointer" }}>
                      📤 Upload my own paper {p.paper_pdf_url ? "· ✅ in use" : ""}
                    </summary>
                    <form action={uploadPaperFiles} style={{ marginTop: 10 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <p className="muted" style={{ fontSize: ".8rem", marginBottom: 8 }}>
                        Students get your PDF exactly as you made it. We only read the text out of it
                        so answers can still be checked against it.
                      </p>
                      <label style={{ fontSize: ".82rem" }}>Question paper (PDF)</label>
                      <input type="file" name="paper_pdf" accept="application/pdf" style={{ marginBottom: 10 }} />
                      <label style={{ fontSize: ".82rem" }}>Solutions (PDF) — never shown to students</label>
                      <input type="file" name="answers_pdf" accept="application/pdf" style={{ marginBottom: 10 }} />
                      <SubmitButton className="btn small" savedLabel="Uploaded">📤 Upload</SubmitButton>
                    </form>
                    {(p.paper_pdf_url || p.answers_pdf_url) && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        {p.paper_pdf_url && (
                          <form action={removeUploadedPaper}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="which" value="paper" />
                            <SubmitButton className="btn small secondary" savedLabel="Removed">🗑️ Remove my question paper</SubmitButton>
                          </form>
                        )}
                        {p.answers_pdf_url && (
                          <form action={removeUploadedPaper}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="which" value="answers" />
                            <SubmitButton className="btn small secondary" savedLabel="Removed">🗑️ Remove my solutions</SubmitButton>
                          </form>
                        )}
                      </div>
                    )}
                  </details>

                  <details style={{ marginTop: 8 }}>
                    <summary className="btn as-btn small secondary" style={{ cursor: "pointer" }}>✏️ Correct it by hand</summary>
                    <form action={savePaper} style={{ marginTop: 10 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <label style={{ fontSize: ".82rem" }}>Question paper</label>
                      <textarea name="questions_md" rows={12} defaultValue={p.questions_md ?? ""} style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: ".78rem" }} />
                      <label style={{ fontSize: ".82rem", marginTop: 8, display: "block" }}>Suggested answers</label>
                      <textarea name="answers_md" rows={12} defaultValue={p.answers_md ?? ""} style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: ".78rem" }} />
                      <SubmitButton className="btn small" savedLabel="Saved">💾 Save</SubmitButton>
                    </form>
                  </details>
                </>
              )}
            </div>
          );
        })}
      </div>

      {papers.length > 0 && (
        <form action={createSet} style={{ marginTop: 16 }}>
          <SubmitButton className="btn small secondary" savedLabel="Checked">➕ Make sure the September 2026 set exists</SubmitButton>
        </form>
      )}
    </section>
  );
}
