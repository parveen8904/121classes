"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured, answerAssistant, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getSiteFacts } from "@/lib/sitefacts";
import { dailyDoubtLimitReached } from "@/lib/limits";
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

  // A signed-in student's daily allowance covers "Ask me" too — it is the same
  // AI answering. Otherwise the 5-a-day on the course page would be bypassed
  // simply by asking from here instead. Visitors who are not signed in are not
  // touched: this is also the shop-window assistant.
  if (user) {
    const { checkQuota } = await import("@/lib/entitlements");
    const q = await checkQuota(user.id, "ask_query");
    if (!q.allowed) {
      return {
        ok: true,
        answer:
          q.limit > 0
            ? `You have used all ${q.limit} of today's questions. They refill tomorrow morning — or send this to the faculty from your course page.`
            : "Asking questions is part of a study plan. Please see Plans & pricing, or renew if your validity has ended.",
      };
    }
  }

  if (user && (await dailyDoubtLimitReached(user.id))) {
    escalated = true; // hit today's AI limit → log for faculty, no AI call
  } else if (await aiConfigured()) {
    const [facts, material] = await Promise.all([getSiteFacts(), getRepositoryContext(null, 8000, { query: question })]);
    const raw = await answerAssistant(question, facts, material);
    if (raw && raw.trim() !== NEED_FACULTY) {
      answer = raw.trim();
      if (user) {
        const { consumeQuota } = await import("@/lib/entitlements");
        await consumeQuota(user.id, "ask_query");
      }
    } else {
      escalated = true; // a subject doubt the material doesn't cover
    }
  } else {
    escalated = true;
  }

  // Log the question (answered ones for the record; open ones for faculty).
  // Store the AI answer as a linked reply row so it appears in the student's
  // own inbox (they can read their own page_questions rows via RLS).
  const svc = createServiceClient();
  const { data: inserted } = await svc
    .from("page_questions")
    .insert({
      user_id: user?.id ?? null,
      email,
      page_path: pagePath,
      question,
      status: answer ? "answered" : "open",
    })
    .select("id")
    .single();
  if (answer && user && inserted?.id) {
    await svc.from("page_questions").insert({
      user_id: user.id,
      question: answer,
      page_path: `reply:${inserted.id}`,
      status: "reply",
    });
  }

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
