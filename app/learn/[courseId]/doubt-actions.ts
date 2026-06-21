"use server";

import { createClient } from "@/lib/supabase/server";
import { aiConfigured, answerDoubtFromMaterial, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { dailyDoubtLimitReached } from "@/lib/limits";

// Subject-scoped doubt: answers instantly from THIS subject's AI repository
// (transcripts + content PDFs). If it can't, the UI offers to send it to faculty.
export async function askSubjectDoubt(input: {
  subjectId: string;
  question: string;
}): Promise<{ ok: boolean; answer: string | null; limited?: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, answer: null };
  const question = (input.question ?? "").trim();
  if (question.length < 3) return { ok: false, answer: null };

  // Max 20 AI queries per student per day (shared counter across doubts + Ask me).
  if (await dailyDoubtLimitReached(user.id)) return { ok: true, answer: null, limited: true };

  let answer: string | null = null;
  if (await aiConfigured()) {
    const material = await getRepositoryContext(input.subjectId, 12000, { query: question });
    const raw = await answerDoubtFromMaterial(question, material);
    if (raw && raw.trim() !== NEED_FACULTY) answer = raw;
  }
  // Log so it counts toward the daily limit and shows in the student's inbox.
  await supabase.from("doubts").insert({
    student_id: user.id,
    question,
    ai_answer: answer,
    status: answer ? "answered" : "open",
  });
  return { ok: true, answer, limited: false };
}
