import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import AdminHero from "../../_components/AdminHero";
import DeleteButton from "../../_components/DeleteButton";
import { addSubjective, deleteSubjective } from "./actions";

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

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="✍️ Subjective test"
        title={section.title}
        subtitle={
          aiConfigured()
            ? "Add written questions — student answers are graded by AI (paper-checking). 🤖"
            : "Add written questions. Connect an AI key to auto-grade, or review answers yourself. ✍️"
        }
        back={{ href: `/admin/topics/${section.topic_id}`, label: "Topic" }}
      />

      <div className="form-card" style={{ marginTop: 24 }}>
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
