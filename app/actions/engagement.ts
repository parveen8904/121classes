"use server";

import { createClient } from "@/lib/supabase/server";
import { aiConfigured, answerAssistant, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getSiteFacts } from "@/lib/sitefacts";
import { notifyFaculty } from "@/lib/notify";

// "Notify me" for a live class/event. Works logged-in (uses account email) or
// logged-out (the visitor types an email).
export async function subscribeReminder(formData: FormData): Promise<{ ok: boolean }> {
  const sessionId = (formData.get("session_id") as string) || null;
  const typed = ((formData.get("email") as string) || "").trim() || null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = typed ?? user?.email ?? null;
  if (!email && !user) return { ok: false };
  await supabase.from("class_reminders").insert({
    session_id: sessionId,
    user_id: user?.id ?? null,
    email,
  });
  return { ok: true };
}

// Site-wide "Ask me": answers instantly. Portal questions (faculty, schedule,
// next live class, contact, how-to) are answered from live site facts; CA
// subject doubts from the AI repository. Anything it can't answer is logged for
// faculty. Returns the answer to show inline.
export async function askQuestion(
  formData: FormData,
): Promise<{ ok: boolean; answer?: string; escalated?: boolean }> {
  const question = ((formData.get("question") as string) || "").trim();
  const pagePath = (formData.get("page_path") as string) || null;
  const typed = ((formData.get("email") as string) || "").trim() || null;
  if (!question) return { ok: false };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = typed ?? user?.email ?? null;

  let answer: string | null = null;
  let escalated = false;

  if (await aiConfigured()) {
    const [facts, material] = await Promise.all([getSiteFacts(), getRepositoryContext(null, 15000)]);
    const raw = await answerAssistant(question, facts, material);
    if (raw && raw.trim() !== NEED_FACULTY) {
      answer = raw.trim();
    } else {
      escalated = true; // a subject doubt the material doesn't cover
    }
  } else {
    escalated = true;
  }

  // Log it (answered ones for the record; open ones for faculty to reply).
  await supabase.from("page_questions").insert({
    user_id: user?.id ?? null,
    email,
    page_path: pagePath,
    question,
    status: answer ? "answered" : "open",
  });

  if (!answer) {
    await notifyFaculty(
      "A question needs your reply (Ask me)",
      `From: ${email ?? user?.id ?? "anonymous"}\nPage: ${pagePath ?? "-"}\n\nQuestion:\n${question}\n\nReply from Admin → Inbox.`,
    );
  }

  return {
    ok: true,
    answer: answer ?? undefined,
    escalated,
  };
}
