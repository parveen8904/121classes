import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../../_components/AdminHero";
import DeleteButton from "../../_components/DeleteButton";
import { addMcq, deleteMcq } from "./actions";

export default async function McqAdminPage({ params }: { params: { sectionId: string } }) {
  const supabase = createClient();
  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type, topic_id")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section) notFound();

  const { data: questions } = await supabase
    .from("mcq_questions")
    .select("id, question, options, correct_index, order_index")
    .eq("section_id", section.id)
    .order("order_index");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🧠 MCQ test"
        title={section.title}
        subtitle="Add multiple-choice questions. They're auto-graded for students. ✅"
        back={{ href: `/admin/topics/${section.topic_id}`, label: "Topic" }}
      />

      <div className="form-card" style={{ marginTop: 24 }}>
        <h3>➕ Add a question</h3>
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

      <h2 className="admin-section-title">📋 Questions</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {questions && questions.length > 0 ? (
          questions.map((q, i) => (
            <div className="card" key={q.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <strong>
                  {i + 1}. {q.question}
                </strong>
                <DeleteButton action={deleteMcq} id={q.id} parentId={section.id} message="Delete this question?" />
              </div>
              <ul className="muted" style={{ fontSize: ".9rem", marginTop: 8, paddingLeft: 18 }}>
                {((q.options as string[]) ?? []).map((o, oi) => (
                  <li key={oi} style={oi === q.correct_index ? { color: "var(--accent)", fontWeight: 700 } : undefined}>
                    {o} {oi === q.correct_index ? "✓" : ""}
                  </li>
                ))}
              </ul>
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
