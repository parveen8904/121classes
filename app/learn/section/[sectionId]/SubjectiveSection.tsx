import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import SubjectiveForm from "./SubjectiveForm";
import DescriptivePaper from "./DescriptivePaper";
import { getMyPaperAttempt } from "./paperActions";

export default async function SubjectiveSection({
  section,
}: {
  section: { id: string; title: string; topic_id: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: cfgRow } = await supabase.from("sections").select("config").eq("id", section.id).maybeSingle();
  const cfg = (cfgRow?.config ?? {}) as Record<string, unknown>;
  const paperQuestion = (cfg.paper_question_pdf as string) || "";
  const paperMode = !!paperQuestion;

  const { data } = await supabase
    .from("subjective_questions")
    .select("id, prompt, max_marks")
    .eq("section_id", section.id);

  const questions = (data ?? []).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    max_marks: q.max_marks,
  }));
  const ai = await aiConfigured();

  const initialAttempt = paperMode && user ? await getMyPaperAttempt(section.id) : null;

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb">
          <Link href={`/learn/topic/${section.topic_id}`}>← Back to topic</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">✍️ Descriptive test</span>
          <h1>{section.title}</h1>
          <p className="meta">
            {paperMode
              ? "A timed paper: solve on paper, photograph your answers, upload — checked against the official solution. 📝"
              : ai
              ? "Write your answer and get instant AI feedback, guided by CA Parveen Sharma's team. 🤖"
              : "Write your answer — our faculty will review and share feedback. ✍️"}
          </p>
        </div>

        <div style={{ marginTop: 22 }}>
          {paperMode && user ? (
            <DescriptivePaper
              sectionId={section.id}
              studentId={user.id}
              title={section.title}
              questionPdf={paperQuestion}
              solutionPdf={(cfg.paper_solution_pdf as string) || ""}
              durationMinutes={Number(cfg.paper_duration_minutes) || 30}
              totalMarks={Number(cfg.paper_total_marks) || 0}
              instructions={(cfg.paper_instructions as string) || ""}
              initial={initialAttempt ?? { status: "none" }}
            />
          ) : questions.length > 0 ? (
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
