"use server";

import { createClient } from "@/lib/supabase/server";
import { aiConfigured, answerDoubtFromMaterial, answerDoubtWithAttachment, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { dailyDoubtLimitReached } from "@/lib/limits";

// Subject-scoped doubt: answers instantly from THIS subject's AI repository
// (transcripts + content PDFs). Optionally the student attaches an image/PDF
// (a photographed question), which the AI reads together with the typed text.
export async function askSubjectDoubt(input: {
  subjectId: string;
  question: string;
  attachment?: { dataB64: string; mediaType: string } | null;
}): Promise<{ ok: boolean; answer: string | null; limited?: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, answer: null };
  const question = (input.question ?? "").trim();
  const att = input.attachment ?? null;
  // Need at least a question or an attachment.
  if (question.length < 3 && !att) return { ok: false, answer: null };

  // Max 20 AI queries per student per day (shared counter across doubts + Ask me).
  if (await dailyDoubtLimitReached(user.id)) return { ok: true, answer: null, limited: true };

  let answer: string | null = null;
  if (await aiConfigured()) {
    // Larger budget so uploaded question banks / ICAI / RTP text is available —
    // needed to find and solve a specific numbered question.
    const material = await getRepositoryContext(input.subjectId, 24000, { query: question });
    const raw = att
      ? await answerDoubtWithAttachment(question, material, att)
      : await answerDoubtFromMaterial(question, material);
    if (raw && raw.trim() !== NEED_FACULTY) answer = raw;
  }
  // Log so it counts toward the daily limit and shows in the student's inbox.
  await supabase.from("doubts").insert({
    student_id: user.id,
    question,
    ai_answer: answer,
    status: answer ? "answered" : "open",
  });
  await supabase.from("student_activity").insert({
    student_id: user.id,
    kind: "doubt",
    detail: { subject_id: input.subjectId, answered: !!answer },
  });
  return { ok: true, answer, limited: false };
}
