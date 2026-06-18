import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import AdminHero from "../../_components/AdminHero";
import DeleteButton from "../../_components/DeleteButton";
import { addSubjective, deleteSubjective, generateSubjectiveFromTranscript } from "./actions";

export default async function SubjectiveAdminPage({ params }: { params: { sectionId: string } }) {
  const supabase = createClient();
  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type, topic_id")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section) notFound();

  const { data: questions } = await supabase
    .from("subjective_questions")
    .select("id, prompt, max_marks")
    .eq("section_id", section.id);
  const ai = await aiConfigured();

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="✍️ Subjective test"
        title={section.title}
        subtitle={
          ai
            ? "Add written questions — student answers are graded by AI (paper-checking). 🤖"
            : "Add written questions. Connect an AI key to auto-grade, or review answers yourself. ✍️"
        }
        back={{ href: `/admin/topics/${section.topic_id}`, label: "Topic" }}
      />

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
              <textarea name="transcript" rows={8} placeholder="Paste the class transcript here…" required />
              <button className="btn" type="submit">
                Generate &amp; save questions
              </button>
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
          <div style={{ maxWidth: 200 }}>
            <label>Max marks</label>
            <input name="max_marks" type="number" defaultValue={10} />
          </div>
          <button className="btn" type="submit">
            Add question
          </button>
        </form>
      </div>

      <h2 className="admin-section-title">📋 Questions</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {questions && questions.length > 0 ? (
          questions.map((q, i) => (
            <div className="list-row" key={q.id}>
              <div>
                <span className="row-title">
                  {i + 1}. {q.prompt}
                </span>
                <p className="row-sub">{q.max_marks ?? 10} marks</p>
              </div>
              <DeleteButton action={deleteSubjective} id={q.id} parentId={section.id} message="Delete this question?" />
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No questions yet — add your first above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
