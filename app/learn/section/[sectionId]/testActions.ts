"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured, gradeSubjective, answerDoubtFromMaterial, answerDoubtWithAttachment, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getMcqExplanations } from "@/lib/answers";
import { dailyDoubtLimitReached } from "@/lib/limits";
import { notifyFaculty, sendEmail, emailShell } from "@/lib/notify";

const SITE_URL = "https://caparveensharma.com";

// Build the student's performance report as a bullet-point email (no AI).
function reportEmailHtml(res: McqResult, title: string, link: string): string {
  const pct = res.total ? Math.round(((res.score ?? 0) / res.total) * 100) : 0;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const li = (s: string) => `<li>${esc(s)}</li>`;
  const parts: string[] = [];
  parts.push(`<p><strong>Score: ${res.score}/${res.total} (${pct}%)</strong> &nbsp;•&nbsp; 🏆 Rank: #${res.rank ?? 1}</p>`);
  if (res.weakConcepts?.length) parts.push(`<p><strong>🔎 Concepts to revise</strong></p><ul>${res.weakConcepts.map(li).join("")}</ul>`);
  if (res.classesToRedo?.length) parts.push(`<p><strong>↩️ Classes to study again</strong></p><ul>${res.classesToRedo.map((c) => li(`Class ${c}`)).join("")}</ul>`);
  parts.push(`<p><strong>📋 Question review</strong></p><ul>`);
  for (const [i, r] of (res.review ?? []).entries()) {
    const mark = r.isCorrect ? "✅" : "❌";
    const correct = r.options[r.correctIndex] ?? "";
    const why = r.isCorrect ? r.whyCorrect : (r.whyChosenWrong ? `${r.whyChosenWrong} ` : "") + (r.whyCorrect ? `Correct: ${r.whyCorrect}` : "");
    parts.push(li(`Q${i + 1} ${mark} ${esc(r.question)} — Answer: ${esc(correct)}${why ? ` — ${esc(why)}` : ""}`));
  }
  parts.push(`</ul>`);
  parts.push(
    `<p><a href="${link}">View your full report</a> &nbsp;•&nbsp; ` +
      `<a href="${link}/paper">⬇️ Question paper (PDF)</a> &nbsp;•&nbsp; ` +
      `<a href="${link}/answers">⬇️ Answer key (PDF)</a></p>`,
  );
  return emailShell(`📝 Your test report — ${title}`, parts.join(""));
}

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

// Build the graded result (score, review, rank, weak concepts, redo classes)
// from a set of answers — pure read, no insert. Reused for live grading and for
// showing a student their one previous attempt.
async function buildMcqResult(
  supabase: ReturnType<typeof createClient>,
  sectionId: string,
  userId: string,
  answers: Record<string, number>,
): Promise<McqResult> {
  const { data: questions } = await supabase
    .from("mcq_questions")
    .select("id, question, options, correct_index, order_index, concept, source_class_no")
    .eq("section_id", sectionId)
    .order("order_index");
  const qs = questions ?? [];
  if (!qs.length) return { ok: false };

  const explain = await getMcqExplanations(qs.map((q) => q.id));

  let score = 0;
  const review: McqReview[] = [];
  const weak = new Set<string>();
  const redo = new Set<string>();
  for (const q of qs) {
    const chosen = answers?.[q.id];
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

  // Leaderboard rank = how many students scored strictly higher (best attempt) + 1.
  // We return only the rank number — never the total number of test-takers.
  let rank = 1;
  try {
    const { data: all } = await createServiceClient()
      .from("mcq_attempts")
      .select("student_id, score")
      .eq("section_id", sectionId);
    const best = new Map<string, number>();
    for (const a of all ?? []) {
      const sid = a.student_id as string;
      best.set(sid, Math.max(best.get(sid) ?? 0, (a.score as number) ?? 0));
    }
    const myBest = Math.max(best.get(userId) ?? 0, score);
    for (const [sid, s] of best) if (sid !== userId && s > myBest) rank += 1;
  } catch {
    rank = 1;
  }

  return { ok: true, score, total, review, rank, weakConcepts: [...weak], classesToRedo: [...redo].sort((a, b) => Number(a) - Number(b)) };
}

// A student may take each topic test only ONCE. Returns their existing result if
// they've already attempted it (so the page shows the report, not the test).
export async function getMyMcqResult(sectionId: string): Promise<(McqResult & { alreadyDone: true }) | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prior } = await supabase
    .from("mcq_attempts")
    .select("answers")
    .eq("student_id", user.id)
    .eq("section_id", sectionId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!prior) return null;
  const res = await buildMcqResult(supabase, sectionId, user.id, (prior.answers as Record<string, number>) ?? {});
  return { ...res, alreadyDone: true };
}

export async function gradeMcqAttempt(input: {
  sectionId: string;
  answers: Record<string, number>;
}): Promise<McqResult & { alreadyDone?: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // Only one attempt per student per test — if they've already taken it, return
  // that result instead of recording a new one.
  const { data: prior } = await supabase
    .from("mcq_attempts")
    .select("answers")
    .eq("student_id", user.id)
    .eq("section_id", input.sectionId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (prior) {
    const res = await buildMcqResult(supabase, input.sectionId, user.id, (prior.answers as Record<string, number>) ?? {});
    return { ...res, alreadyDone: true };
  }

  const res = await buildMcqResult(supabase, input.sectionId, user.id, input.answers ?? {});
  if (!res.ok) return res;

  await supabase.from("mcq_attempts").insert({
    student_id: user.id,
    section_id: input.sectionId,
    score: res.score,
    total: res.total,
    answers: input.answers ?? {},
    report: { rank: res.rank, weakConcepts: res.weakConcepts, classesToRedo: res.classesToRedo },
  });
  await supabase.from("student_activity").insert({
    student_id: user.id,
    kind: "test_submitted",
    section_id: input.sectionId,
    detail: { score: res.score, total: res.total },
  });

  // Email the report to the student (best-effort — never block grading on it).
  try {
    if (user.email) {
      const { data: sec } = await supabase.from("sections").select("title").eq("id", input.sectionId).maybeSingle();
      const title = sec?.title ?? "Test";
      await sendEmail(user.email, `📝 Your test report — ${title}`, reportEmailHtml(res, title, `${SITE_URL}/learn/section/${input.sectionId}`));
    }
  } catch {
    /* email failure must not fail the submission */
  }

  return res;
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
  attachment?: { dataB64: string; mediaType: string } | null;
}): Promise<{ ok: boolean; answer: string | null; pending: boolean; note?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, answer: null, pending: false };
  const question = (input.question ?? "").trim();
  const att = input.attachment ?? null;
  if (!question && !att) return { ok: false, answer: null, pending: false };

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
    const material = await getRepositoryContext(subjectId, att ? 24000 : 12000, { topicId, query: question });
    const raw = att
      ? await answerDoubtWithAttachment(question, material, att)
      : await answerDoubtFromMaterial(question, material);
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

// Admin preview: wipe MY OWN attempt so the MCQ test can be taken again.
// Strictly admin — students keep the one-attempt rule.
export async function resetMyMcqAttempt(formData: FormData) {
  const sectionId = String(formData.get("sectionId") || "");
  if (!sectionId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return;
  await supabase.from("mcq_attempts").delete().eq("student_id", user.id).eq("section_id", sectionId);
  revalidatePath(`/learn/section/${sectionId}`);
}
