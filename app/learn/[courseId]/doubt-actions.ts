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
}): Promise<{ ok: boolean; answer: string | null }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, answer: null };
  const question = (input.question ?? "").trim();
  if (question.length < 3) return { ok: false, answer: null };

  let answer: string | null = null;
  const limited = await dailyDoubtLimitReached(user.id);
  if (!limited && (await aiConfigured())) {
    const material = await getRepositoryContext(input.subjectId, 12000, { query: question });
    const raw = await answerDoubtFromMaterial(question, material);
    if (raw && raw.trim() !== NEED_FACULTY) answer = raw;
  }
  return { ok: true, answer };
}
