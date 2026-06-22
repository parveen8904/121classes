import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import AdminHero from "../../_components/AdminHero";
import DeleteButton from "../../_components/DeleteButton";
import { addMcq, updateMcq, bulkAddMcq, deleteMcq, generateMcqsFromTranscript, generateChapterTest, attachSectionPdf } from "./actions";
import PdfUpload from "../../_components/PdfUpload";
import SubmitButton from "@/app/components/SubmitButton";
import { getMcqExplanations } from "@/lib/answers";

export default async function McqAdminPage({ params }: { params: { sectionId: string } }) {
  const supabase = createClient();
  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type, topic_id, config")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section) notFound();
  const refPdf = ((section.config ?? {}) as Record<string, string>).pdf_url ?? "";
  const qCount = Number((section.config as Record<string, unknown> | null)?.question_count) || 20;

  const { data: questions } = await supabase
    .from("mcq_questions")
    .select("id, question, options, correct_index, order_index, concept, source_class_no")
    .eq("section_id", section.id)
    .order("order_index");
  const ai = await aiConfigured();
  const explain = await getMcqExplanations((questions ?? []).map((q) => q.id));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🧠 MCQ test"
        title={section.title}
        subtitle="Add multiple-choice questions. They're auto-graded for students. ✅"
        back={{ href: `/admin/topics/${section.topic_id}`, label: "Topic" }}
      />

      {/* Attach a reference PDF (question paper / answer key) */}
      <form action={attachSectionPdf} className="form-card" style={{ marginTop: 14 }}>
        <input type="hidden" name="section_id" value={section.id} />
        <PdfUpload name="pdf_url" defaultValue={refPdf} label="📄 Attach a PDF (question paper / answer key) — shown to students" />
        <SubmitButton className="btn small" style={{ marginTop: 8 }}>Save PDF</SubmitButton>
      </form>

      {/* Standard rule: 2 MCQs per class for the whole topic, once. */}
      {ai && (
        <div className="form-card" style={{ marginTop: 18 }}>
          <h3>🤖 Generate the chapter test — 2 MCQs per class</h3>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 0, marginBottom: 10 }}>
            Reads every published class in this topic and writes questions across all classes (with the correct/wrong reasons,
            concept and source class), saving them here. Run <strong>once</strong> — students take the saved test with no further
            AI. Use the tick to re-generate from scratch.
          </p>
          <form action={generateChapterTest}>
            <input type="hidden" name="section_id" value={section.id} />
            <label htmlFor="q-count">Number of questions (10–30)</label>
            <input id="q-count" name="count" type="number" min={10} max={30} defaultValue={qCount} style={{ maxWidth: 140 }} />
            <label className="remember" style={{ marginTop: 8 }}>
              <input type="checkbox" name="replace" /> ♻️ Replace all existing questions (otherwise add to them)
            </label>
            <SubmitButton className="btn" savedLabel="✓ Generated">Generate questions</SubmitButton>
          </form>
        </div>
      )}

      {/* AI generation — run once, questions are stored & served statically */}
      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">🤖 Generate from a pasted transcript (AI)</summary>
        <div className="form-card" style={{ marginTop: 12, width: "100%" }}>
          <h3>🤖 Generate MCQs with AI</h3>
          {ai ? (
            <>
              <p className="muted" style={{ fontSize: ".82rem", marginTop: 0, marginBottom: 10 }}>
                Paste the class transcript. AI writes the questions <strong>once</strong> and saves them below —
                students take the test with no AI cost. Review/edit before publishing.
              </p>
              <form action={generateMcqsFromTranscript}>
                <input type="hidden" name="section_id" value={section.id} />
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
                  <div>
                    <label>Topic / chapter (optional)</label>
                    <input name="topic" placeholder="e.g. IND AS 115 — Revenue" />
                  </div>
                  <div>
                    <label>How many questions?</label>
                    <input name="count" type="number" min={1} max={25} defaultValue={10} />
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
                <button className="btn" type="submit">
                  Generate &amp; save questions
                </button>
              </form>
            </>
          ) : (
            <p className="muted" style={{ fontSize: ".9rem", marginBottom: 0 }}>
              AI isn&apos;t switched on yet. Add <code>ANTHROPIC_API_KEY</code> in Vercel and redeploy, then this
              will generate questions from a transcript automatically.
            </p>
          )}
        </div>
      </details>

      {/* Bulk upload — no AI. Admin pastes many questions at once. */}
      <details style={{ marginTop: 14 }}>
        <summary className="btn small secondary as-btn">📥 Bulk add questions (paste — no AI)</summary>
        <div className="form-card" style={{ marginTop: 10 }}>
          <h3>📥 Paste / upload your own questions</h3>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
            One question per block, a <strong>blank line between blocks</strong>. First line = the question, then the options
            (one per line). Put a <strong>*</strong> in front of the correct option. These add to <strong>this</strong> test, and
            students take &amp; get auto-graded on them just like AI questions.
          </p>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
            Optional (improves the student&apos;s report): add a line <strong>Concept: …</strong> and/or <strong>Why: …</strong> to any block.
            <strong> Concept</strong> feeds &ldquo;concepts to revise&rdquo;; <strong>Why</strong> is shown as the correct-answer reason. Even without
            these, CA Parveen Sharma&apos;s AI note in the report analyses what the student got wrong.
          </p>
          <form action={bulkAddMcq}>
            <input type="hidden" name="section_id" value={section.id} />
            <textarea
              name="bulk"
              rows={10}
              placeholder={"Under AS 13, investments are classified as?\n*Current and long-term investments\nFixed and floating investments\nTrade and non-trade only\nQuoted and unquoted only\nConcept: AS 13 — classification of investments\nWhy: AS 13 splits investments into current and long-term.\n\nThe cost of a current investment includes?\n*Purchase price plus acquisition charges\nPurchase price only\nMarket value on balance sheet date\nFace value of the investment"}
            />
            <button className="btn small" type="submit" style={{ marginTop: 8 }}>Add these questions</button>
          </form>
        </div>
      </details>

      <div className="form-card" style={{ marginTop: 14 }}>
        <h3>➕ Add a single question</h3>
        <form action={addMcq}>
          <input type="hidden" name="section_id" value={section.id} />
          <label>Question</label>
          <input name="question" placeholder="e.g. Under AS 24, a discontinuing operation is…" required />
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
            Fill at least two options and pick the correct one.
          </p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label className="remember" style={{ margin: 0 }}>
                <input type="radio" name="correct" value={i} defaultChecked={i === 0} /> Correct
              </label>
              <input name={`opt${i}`} placeholder={`Option ${i + 1}`} style={{ marginBottom: 10 }} />
            </div>
          ))}
          <button className="btn" type="submit">
            Add question
          </button>
        </form>
      </div>

      {(questions ?? []).length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          <a className="btn small secondary" href={`/learn/section/${section.id}/paper`} target="_blank" rel="noopener noreferrer">⬇️ Question paper (PDF)</a>
          <a className="btn small secondary" href={`/learn/section/${section.id}/answers`} target="_blank" rel="noopener noreferrer">⬇️ Answer key + explanations (PDF)</a>
        </div>
      )}

      <h2 className="admin-section-title">📋 Questions ({(questions ?? []).length})</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>Tap a question to review the correct/wrong answers + explanations and edit anything.</p>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {questions && questions.length > 0 ? (
          questions.map((q, i) => {
            const opts = ((q.options as string[]) ?? []);
            const ex = explain.get(q.id);
            return (
              <details className="card" key={q.id}>
                <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong>{i + 1}. {q.question}</strong>
                  <span className="muted" style={{ fontSize: ".8rem" }}>
                    ✓ {opts[q.correct_index] ?? "?"}{q.source_class_no ? ` · Class ${q.source_class_no}` : ""}{q.concept ? ` · ${q.concept}` : ""}
                  </span>
                </summary>
                <form action={updateMcq} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="section_id" value={section.id} />
                  <label>Question</label>
                  <input name="question" defaultValue={q.question} required />
                  <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0 4px" }}>Pick the correct option; the reason lines power the student&apos;s report.</p>
                  {[0, 1, 2, 3].map((oi) => (
                    <div key={oi} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1.4fr", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <label className="remember" style={{ margin: 0 }}>
                        <input type="radio" name="correct" value={oi} defaultChecked={oi === q.correct_index} /> ✓
                      </label>
                      <input name={`opt${oi}`} defaultValue={opts[oi] ?? ""} placeholder={`Option ${oi + 1}`} />
                      <input name={`why${oi}`} defaultValue={ex?.ww?.[oi] ?? ""} placeholder={`Why option ${oi + 1} is right/wrong`} />
                    </div>
                  ))}
                  <label>Why the correct answer is correct (overall)</label>
                  <input name="why_correct" defaultValue={ex?.wc ?? ""} placeholder="One-line explanation of the correct answer" />
                  <label>Concept tested (optional)</label>
                  <input name="concept" defaultValue={q.concept ?? ""} placeholder="e.g. Cost of a current investment" />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <SubmitButton className="btn small" closeDetails>Save changes</SubmitButton>
                    <DeleteButton action={deleteMcq} id={q.id} parentId={section.id} message="Delete this question?" />
                  </div>
                </form>
              </details>
            );
          })
        ) : (
          <div className="card">
            <p className="muted">📭 No questions yet — add your first above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
