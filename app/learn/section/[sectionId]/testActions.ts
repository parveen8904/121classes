"use server";

import { createClient } from "@/lib/supabase/server";
import { aiConfigured, gradeSubjective, answerDoubt } from "@/lib/ai";

export async function gradeMcqAttempt(input: {
  sectionId: string;
  answers: Record<string, number>;
}): Promise<{ ok: boolean; score?: number; total?: number }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // correct_index is fetched server-side only — never sent to the browser.
  const { data: questions } = await supabase
    .from("mcq_questions")
    .select("id, correct_index")
    .eq("section_id", input.sectionId);
  const qs = questions ?? [];
  if (!qs.length) return { ok: false };

  let score = 0;
  for (const q of qs) {
    if (input.answers?.[q.id] === q.correct_index) score += 1;
  }
  const total = qs.length;

  await supabase.from("mcq_attempts").insert({
    student_id: user.id,
    section_id: input.sectionId,
    score,
    total,
    answers: input.answers ?? {},
  });

  return { ok: true, score, total };
}

export async function submitSubjective(input: {
  questionId: string;
  answer: string;
}): Promise<{ ok: boolean; status: string; score: number | null; feedback: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: "error", score: null, feedback: "" };
  const answer = (input.answer ?? "").trim();
  if (!answer) return { ok: false, status: "error", score: null, feedback: "" };

  const { data: q } = await supabase
    .from("subjective_questions")
    .select("id, prompt, max_marks")
    .eq("id", input.questionId)
    .maybeSingle();
  if (!q) return { ok: false, status: "error", score: null, feedback: "" };

  let score: number | null = null;
  let feedback = "✅ Submitted! Our faculty will review your answer and share feedback soon.";
  let status = "submitted";

  if (aiConfigured()) {
    const graded = await gradeSubjective(q.prompt, answer, q.max_marks);
    if (graded) {
      score = graded.score;
      feedback = graded.feedback || feedback;
      status = "graded";
    }
  }

  await supabase.from("subjective_submissions").insert({
    student_id: user.id,
    question_id: q.id,
    answer_text: answer,
    ai_score: score,
    ai_feedback: feedback,
    status,
  });

  return { ok: true, status, score, feedback };
}

export async function askDoubt(input: {
  sectionId: string;
  question: string;
}): Promise<{ ok: boolean; answer: string | null; pending: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, answer: null, pending: false };
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, answer: null, pending: false };

  // Topic title gives the AI a little context.
  const { data: section } = await supabase
    .from("sections")
    .select("topics(title)")
    .eq("id", input.sectionId)
    .maybeSingle();
  const context = (section as { topics?: { title?: string } | null } | null)?.topics?.title;

  let answer: string | null = null;
  let status = "open";
  if (aiConfigured()) {
    answer = await answerDoubt(question, context);
    if (answer) status = "answered";
  }

  await supabase.from("doubts").insert({
    student_id: user.id,
    section_id: input.sectionId,
    question,
    ai_answer: answer,
    status,
  });

  return { ok: true, answer, pending: !answer };
}
