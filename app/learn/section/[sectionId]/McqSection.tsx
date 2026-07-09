import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import McqForm from "./McqForm";
import { getMyMcqResult, resetMyMcqAttempt } from "./testActions";

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

  const { data: cfgRow } = await supabase.from("sections").select("config").eq("id", section.id).maybeSingle();
  const minutesPerQuestion = Number((cfgRow?.config as Record<string, unknown> | null)?.minutes_per_question) || 1;

  const questions = (data ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    options: (q.options as string[]) ?? [],
  }));

  // One attempt per student — if they've already taken it, show their report.
  const lockedResult = await getMyMcqResult(section.id);
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = user ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null };
  const isAdmin = prof?.role === "admin";

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 980 }}>
        <p className="crumb">
          <Link href={`/learn/topic/${section.topic_id}`}>← Back to topic</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">🧠 MCQ test</span>
          <h1>{section.title}</h1>
          <p className="meta">Auto-graded the moment you submit. Good luck! 🍀</p>
        </div>

        <div style={{ marginTop: 22 }}>
          {isAdmin && lockedResult && (
            <form action={resetMyMcqAttempt} style={{ marginBottom: 12 }}>
              <input type="hidden" name="sectionId" value={section.id} />
              <button className="btn small secondary" type="submit">🔄 Reset my attempt (admin preview)</button>
            </form>
          )}
          {questions.length > 0 ? (
            <McqForm sectionId={section.id} questions={questions} minutesPerQuestion={minutesPerQuestion} topicId={section.topic_id} lockedResult={lockedResult} />
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
