"use server";

import { createClient } from "@/lib/supabase/server";
import { aiConfigured, answerDoubtFromMaterial, answerDoubtWithAttachment, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { dailyDoubtLimitReached } from "@/lib/limits";
import { checkQuota, consumeQuota, studentPlan } from "@/lib/entitlements";

// Subject-scoped doubt: answers instantly from THIS subject's AI repository
// (transcripts + content PDFs). Optionally the student attaches an image/PDF
// (a photographed question), which the AI reads together with the typed text.
export async function askSubjectDoubt(input: {
  subjectId: string;
  question: string;
  attachment?: { dataB64: string; mediaType: string } | null;
}): Promise<{ ok: boolean; answer: string | null; limited?: boolean; upgrade?: boolean; used?: number; limit?: number; paid?: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, answer: null };
  const question = (input.question ?? "").trim();
  const att = input.attachment ?? null;
  // Need at least a question or an attachment.
  if (question.length < 3 && !att) return { ok: false, answer: null };

  // Plan quota. This allowance is DAILY (see periodFor): Gold gets 5 questions
  // a day, refilled every morning. A student without a valid plan gets none —
  // which is also what an expired subscription now means.
  const q = await checkQuota(user.id, "ask_query");
  if (!q.allowed) {
    const paid = (await studentPlan(user.id)) !== "free";
    return { ok: true, answer: null, upgrade: true, used: q.used, limit: q.limit, paid };
  }

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
  // Count this query toward the daily allowance — but only if the student
  // actually got an answer. With five a day, burning one on a question the
  // material could not answer would be unfair.
  if (answer) await consumeQuota(user.id, "ask_query");
  return { ok: true, answer, limited: false };
}
