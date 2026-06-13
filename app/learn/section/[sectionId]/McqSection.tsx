import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import McqForm from "./McqForm";

export default async function McqSection({
  section,
}: {
  section: { id: string; title: string; topic_id: string };
}) {
  const supabase = createClient();
  // NOTE: correct_index is intentionally NOT selected — it must never reach the browser.
  const { data } = await supabase
    .from("mcq_questions")
    .select("id, question, options, order_index")
    .eq("section_id", section.id)
    .order("order_index");

  const questions = (data ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    options: (q.options as string[]) ?? [],
  }));

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb">
          <Link href={`/learn/topic/${section.topic_id}`}>← Back to topic</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">🧠 MCQ test</span>
          <h1>{section.title}</h1>
          <p className="meta">Auto-graded the moment you submit. Good luck! 🍀</p>
        </div>

        <div style={{ marginTop: 22 }}>
          {questions.length > 0 ? (
            <McqForm sectionId={section.id} questions={questions} />
          ) : (
            <div className="card">
              <p className="muted">📭 No questions added to this test yet.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
