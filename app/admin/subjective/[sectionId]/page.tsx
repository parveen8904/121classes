import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import AdminHero from "../../_components/AdminHero";
import DeleteButton from "../../_components/DeleteButton";
import { addSubjective, updateSubjective, deleteSubjective, generateSubjectiveFromTranscript, attachSectionPdf, savePaperConfig } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";
import PdfUpload from "../../_components/PdfUpload";

export const dynamic = "force-dynamic";
// Saving may call AI to read the time/marks off the paper — allow time.
export const maxDuration = 60;

type Rubric = { point: string; marks: number }[];
const rubricToText = (r: Rubric | null | undefined) => (r ?? []).map((x) => `${x.point} | ${x.marks}`).join("\n");
const LEVELS = ["Easy", "Medium", "Hard", "Exam-level"];

export default async function SubjectiveAdminPage(props: { params: Promise<{ sectionId: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type, topic_id, config")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section) notFound();
  const cfg = (section.config ?? {}) as Record<string, unknown>;
  const refPdf = (cfg.pdf_url as string) ?? "";
  const paperQ = (cfg.paper_question_pdf as string) ?? "";
  const paperS = (cfg.paper_solution_pdf as string) ?? "";
  const paperDur = Number(cfg.paper_duration_minutes) || 0;
  const paperMarks = Number(cfg.paper_total_marks) || 0;
  const paperInstr = (cfg.paper_instructions as string) ?? "";

  const { data: questions } = await supabase
    .from("subjective_questions")
    .select("id, prompt, max_marks, level, model_answer, rubric, order_index")
    .eq("section_id", section.id)
    .order("order_index");
  const ai = await aiConfigured();

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📝 Descriptive test"
        title={section.title}
        subtitle="Just upload your question paper and your model-answer PDF. Students solve on paper, upload photos, and AI checks their handwriting against your answers — marks, comments and a checked copy."
        back={{ href: `/admin/topics/${section.topic_id}`, label: "Topic" }}
      />

      {/* THE WHOLE TEST: two PDFs. Time + marks are read off the paper. */}
      <div className="form-card" style={{ marginTop: 14, border: "2px solid var(--accent)" }}>
        <h3>📝 Upload your test — just 2 PDFs</h3>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
          Upload the <strong>question paper</strong> and the <strong>model answers</strong> — that&apos;s all. We read the
          <strong> time allowed</strong> and <strong>marks</strong> off the paper, give students that time + 10 minutes to upload their
          handwritten answers, and AI grades them against your model answers (marks, comments &amp; a checked copy).
          {paperQ ? <strong style={{ color: "#16a34a" }}> ✅ This test is live.</strong> : null}
        </p>
        <form action={savePaperConfig}>
          <input type="hidden" name="section_id" value={section.id} />
          <PdfUpload name="paper_question_pdf" defaultValue={paperQ} label="📄 Question paper (PDF)" />
          <div style={{ marginTop: 10 }}>
            <PdfUpload name="paper_solution_pdf" defaultValue={paperS} label="✅ Model answers (PDF)" />
          </div>
          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: ".85rem" }}>⏱️ Time &amp; marks — optional (we read them from the paper)</summary>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
              <div>
                <label>Time (minutes)</label>
                <input name="paper_duration_minutes" type="number" min={1} defaultValue={paperDur || ""} placeholder="auto from paper" />
                <p className="muted" style={{ fontSize: ".75rem", margin: "2px 0 0" }}>Students get this + 10 min to upload.</p>
              </div>
              <div>
                <label>Total marks</label>
                <input name="paper_total_marks" type="number" min={0} defaultValue={paperMarks || ""} placeholder="auto from paper" />
              </div>
            </div>
            <label style={{ marginTop: 10 }}>Extra instructions to students (optional)</label>
            <textarea name="paper_instructions" rows={2} defaultValue={paperInstr} placeholder="e.g. Attempt all questions. Show full working. Write neatly." />
          </details>
          <SubmitButton className="btn" style={{ marginTop: 10 }} savedLabel="✓ Saved">Save test</SubmitButton>
        </form>
        {paperQ && (
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>
            Currently: ⏱️ <strong>{paperDur} min</strong> to solve (+10 to upload){paperMarks ? <> · 🏆 <strong>{paperMarks} marks</strong></> : null}
            {paperS ? "" : " · ⚠️ add the model-answers PDF so AI can grade"}. Students can take it now.
          </p>
        )}
      </div>

      {/* Everything below is the OLD typed question-by-question test — optional. */}
      <details style={{ marginTop: 18 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>⚙️ Advanced (optional): build a typed question-by-question test instead</summary>
        <div style={{ marginTop: 12 }}>

      {/* Attach a reference PDF (question paper / answer key) — for typed Q&A tests. */}
      <form action={attachSectionPdf} className="form-card" style={{ marginTop: 14 }}>
        <input type="hidden" name="section_id" value={section.id} />
        <PdfUpload name="pdf_url" defaultValue={refPdf} label="📄 Attach a reference PDF (for typed Q&A tests) — shown to students" />
        <SubmitButton className="btn small" style={{ marginTop: 8 }}>Save PDF</SubmitButton>
      </form>

      {ai && (
        <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <summary className="btn as-btn">🤖 Generate from transcript (AI)</summary>
          <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
            <h3>🤖 Generate descriptive questions with AI</h3>
            <p className="muted" style={{ fontSize: ".82rem", marginTop: 0, marginBottom: 10 }}>
              Paste the class transcript — AI writes exam-style long-form questions <strong>once</strong> and saves
              them below. Review before publishing.
            </p>
            <form action={generateSubjectiveFromTranscript}>
              <input type="hidden" name="section_id" value={section.id} />
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
                <div>
                  <label>Topic / chapter (optional)</label>
                  <input name="topic" placeholder="e.g. IND AS 115 — Revenue" />
                </div>
                <div>
                  <label>How many questions?</label>
                  <input name="count" type="number" min={1} max={15} defaultValue={5} />
                </div>
              </div>
              <label>Transcript</label>
              <textarea name="transcript" rows={8} placeholder="Paste the class transcript here… (or tick the box below to use your AI Repository)" />
              <label className="remember" style={{ marginTop: 8 }}>
                <input type="checkbox" name="use_repo" /> 📚 Use my AI Repository for this subject (instead of pasting)
              </label>
              <label className="remember" style={{ marginTop: 4 }}>
                <input type="checkbox" name="replace" /> ♻️ Revise — replace the existing questions (otherwise new ones are added)
              </label>
              <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                Generated <strong>once</strong> and saved — every student attempts the same questions. They never change until you revise here.
              </p>
              <SubmitButton className="btn" savedLabel="✓ Generated">Generate &amp; save questions</SubmitButton>
            </form>
          </div>
        </details>
      )}

      <div className="form-card" style={{ marginTop: 14 }}>
        <h3>➕ Add a question</h3>
        <form action={addSubjective}>
          <input type="hidden" name="section_id" value={section.id} />
          <label>Question / prompt</label>
          <textarea name="prompt" rows={3} placeholder="e.g. Explain the disclosure requirements under AS 24." required />
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Max marks</label>
              <input name="max_marks" type="number" defaultValue={10} />
            </div>
            <div>
              <label>Level</label>
              <select name="level" defaultValue="">
                <option value="">—</option>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <label>Model answer (the ideal answer — saved once, shown to students after they submit)</label>
          <textarea name="model_answer" rows={4} placeholder="The complete model answer…" />
          <label>Marking scheme — one point per line, <code>point | marks</code></label>
          <textarea name="rubric" rows={4} placeholder={"Defines what disclosure means | 2\nLists all 4 disclosure requirements | 4\nGives an example | 2"} />
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
            The AI grades each student&apos;s answer against exactly these points and marks — your scheme, not random web data.
          </p>
          <SubmitButton className="btn" savedLabel="✓ Added">Add question</SubmitButton>
        </form>
      </div>

      <h2 className="admin-section-title">📋 Questions</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {questions && questions.length > 0 ? (
          questions.map((q, i) => {
            const rubric = (q.rubric as Rubric | null) ?? [];
            const rubricTotal = rubric.reduce((s, x) => s + (x.marks || 0), 0);
            return (
              <div className="card" key={q.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>{i + 1}. {q.prompt}</strong>
                    <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                      {q.max_marks ?? 10} marks{q.level ? ` · ${q.level}` : ""}
                      {rubric.length ? ` · ${rubric.length} marking points (${rubricTotal} marks)` : " · ⚠️ no marking scheme"}
                      {q.model_answer ? " · ✅ model answer" : " · ⚠️ no model answer"}
                    </p>
                  </div>
                  <DeleteButton action={deleteSubjective} id={q.id} parentId={section.id} message="Delete this question?" />
                </div>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: ".9rem" }}>Edit question &amp; marking scheme</summary>
                  <form action={updateSubjective} style={{ marginTop: 12 }}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="section_id" value={section.id} />
                    <label>Question / prompt</label>
                    <textarea name="prompt" rows={3} defaultValue={q.prompt} required />
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                      <div>
                        <label>Max marks</label>
                        <input name="max_marks" type="number" defaultValue={q.max_marks ?? 10} />
                      </div>
                      <div>
                        <label>Level</label>
                        <select name="level" defaultValue={q.level ?? ""}>
                          <option value="">—</option>
                          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                    <label>Model answer</label>
                    <textarea name="model_answer" rows={4} defaultValue={q.model_answer ?? ""} />
                    <label>Marking scheme — <code>point | marks</code> per line</label>
                    <textarea name="rubric" rows={4} defaultValue={rubricToText(rubric)} />
                    <SubmitButton className="btn small">Save</SubmitButton>
                  </form>
                </details>
              </div>
            );
          })
        ) : (
          <div className="card">
            <p className="muted">📭 No questions yet — add your first above.</p>
          </div>
        )}
      </div>
        </div>
      </details>
    </section>
  );
}
