"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured, gradeSubjective, answerDoubtFromMaterial, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getMcqExplanations } from "@/lib/answers";
import { dailyDoubtLimitReached } from "@/lib/limits";
import { notifyFaculty } from "@/lib/notify";

// Per-question review shown AFTER submit. For a correct answer we show why it's
// correct; for a wrong one we explain only the chosen wrong option + the correct
// option (not the other options). Uses pre-saved explanations — no AI here.
export type McqReview = {
  question: string;
  options: string[];
  chosenIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  whyCorrect: string;
  whyChosenWrong: string;
  concept: string;
  sourceClassNo: string;
};

export type McqResult = {
  ok: boolean;
  score?: number;
  total?: number;
  review?: McqReview[];
  rank?: number; // leaderboard position; we never reveal how many took the test
  weakConcepts?: string[];
  classesToRedo?: string[];
};

export async function gradeMcqAttempt(input: {
  sectionId: string;
  answers: Record<string, number>;
}): Promise<McqResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // correct_index is fetched server-side only — never sent to the browser before grading.
  const { data: questions } = await supabase
    .from("mcq_questions")
    .select("id, question, options, correct_index, order_index, concept, source_class_no")
    .eq("section_id", input.sectionId)
    .order("order_index");
  const qs = questions ?? [];
  if (!qs.length) return { ok: false };

  const explain = await getMcqExplanations(qs.map((q) => q.id));

  let score = 0;
  const review: McqReview[] = [];
  const weak = new Set<string>();
  const redo = new Set<string>();
  for (const q of qs) {
    const chosen = input.answers?.[q.id];
    const isCorrect = chosen === q.correct_index;
    if (isCorrect) score += 1;
    else {
      if (q.concept) weak.add(q.concept as string);
      if (q.source_class_no) redo.add(String(q.source_class_no));
    }
    const ex = explain.get(q.id);
    review.push({
      question: q.question,
      options: (q.options as string[]) ?? [],
      chosenIndex: typeof chosen === "number" ? chosen : -1,
      correctIndex: q.correct_index,
      isCorrect,
      whyCorrect: ex?.wc ?? "",
      whyChosenWrong: !isCorrect && ex?.ww && typeof chosen === "number" ? ex.ww[chosen] ?? "" : "",
      concept: (q.concept as string) ?? "",
      sourceClassNo: q.source_class_no ? String(q.source_class_no) : "",
    });
  }
  const total = qs.length;

  await supabase.from("mcq_attempts").insert({
    student_id: user.id,
    section_id: input.sectionId,
    score,
    total,
    answers: input.answers ?? {},
  });

  // Leaderboard rank = how many students scored strictly higher (best attempt) + 1.
  // We return only the rank number — never the total number of test-takers.
  let rank = 1;
  try {
    const { data: all } = await createServiceClient()
      .from("mcq_attempts")
      .select("student_id, score")
      .eq("section_id", input.sectionId);
    const best = new Map<string, number>();
    for (const a of all ?? []) {
      const sid = a.student_id as string;
      best.set(sid, Math.max(best.get(sid) ?? 0, (a.score as number) ?? 0));
    }
    const myBest = Math.max(best.get(user.id) ?? 0, score);
    for (const [sid, s] of best) if (sid !== user.id && s > myBest) rank += 1;
  } catch {
    rank = 1;
  }

  return {
    ok: true,
    score,
    total,
    review,
    rank,
    weakConcepts: [...weak],
    classesToRedo: [...redo].sort((a, b) => Number(a) - Number(b)),
  };
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
    .select("id, prompt, max_marks, rubric, model_answer")
    .eq("id", input.questionId)
    .maybeSingle();
  if (!q) return { ok: false, status: "error", score: null, feedback: "" };

  let score: number | null = null;
  let feedback = "✅ Submitted! Our faculty will review your answer and share feedback soon.";
  let status = "submitted";

  if (await aiConfigured()) {
    const graded = await gradeSubjective(q.prompt, answer, q.max_marks, q.rubric as { point: string; marks: number }[] | null, q.model_answer);
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
}): Promise<{ ok: boolean; answer: string | null; pending: boolean; note?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, answer: null, pending: false };
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, answer: null, pending: false };

  // Find the subject so we can pull the right repository material.
  const { data: section } = await supabase
    .from("sections")
    .select("topic_id, topics(subject_id)")
    .eq("id", input.sectionId)
    .maybeSingle();
  const subjectId =
    (section as { topics?: { subject_id?: string } | null } | null)?.topics?.subject_id ?? null;
  const topicId = (section as { topic_id?: string | null } | null)?.topic_id ?? null;

  // Answer ONLY from the repository. Focus on THIS topic (smaller, cheaper
  // context); if it's not covered, forward to faculty.
  let answer: string | null = null;
  let status = "open";
  const limited = await dailyDoubtLimitReached(user.id);
  if (!limited && await aiConfigured()) {
    const material = await getRepositoryContext(subjectId, 12000, { topicId, query: question });
    const raw = await answerDoubtFromMaterial(question, material);
    if (raw && raw.trim() !== NEED_FACULTY) {
      answer = raw;
      status = "answered";
    }
  }

  await supabase.from("doubts").insert({
    student_id: user.id,
    section_id: input.sectionId,
    question,
    ai_answer: answer,
    status,
  });

  // Couldn't answer from the repository → alert faculty to reply.
  if (status === "open") {
    await notifyFaculty(
      "A student doubt needs your reply",
      `From: ${user.email ?? user.id}\n\nQuestion:\n${question}\n\nReply from Admin → Inbox.`,
    );
  }

  if (limited) {
    return {
      ok: true,
      answer: null,
      pending: true,
      note: "You've reached today's AI-doubt limit. Your question is saved and our faculty will reply soon.",
    };
  }
  return { ok: true, answer, pending: !answer };
}
