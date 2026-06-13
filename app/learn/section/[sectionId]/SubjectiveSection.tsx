import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import SubjectiveForm from "./SubjectiveForm";

export default async function SubjectiveSection({
  section,
}: {
  section: { id: string; title: string; topic_id: string };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("subjective_questions")
    .select("id, prompt, max_marks")
    .eq("section_id", section.id);

  const questions = (data ?? []).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    max_marks: q.max_marks,
  }));

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb">
          <Link href={`/learn/topic/${section.topic_id}`}>← Back to topic</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">✍️ Subjective test</span>
          <h1>{section.title}</h1>
          <p className="meta">
            {aiConfigured()
              ? "Write your answer and get instant AI feedback, guided by CA Parveen Sharma's team. 🤖"
              : "Write your answer — our faculty will review and share feedback. ✍️"}
          </p>
        </div>

        <div style={{ marginTop: 22 }}>
          {questions.length > 0 ? (
            <SubjectiveForm questions={questions} />
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
