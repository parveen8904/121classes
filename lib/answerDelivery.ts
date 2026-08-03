import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage } from "@/lib/notify";
import { sendTemplate } from "@/lib/emailTemplates";

// Getting an answer TO the student — Telegram if they are reachable there,
// otherwise email — and leaving the same record behind either way.
//
// This used to live only inside the admin reply action, so an answer could
// only ever reach a student by CA Parveen Sharma pressing send. Now that
// doubts are answered automatically, both paths deliver through here and
// behave identically.

export async function deliverQuestionAnswer(
  questionId: string,
  reply: string,
  opts: { markStatus?: string } = {},
): Promise<{ delivered: boolean; via: "telegram" | "email" | "none" }> {
  const text = (reply ?? "").trim();
  if (!questionId || !text) return { delivered: false, via: "none" };

  const svc = createServiceClient();
  const { data: q } = await svc
    .from("page_questions")
    .select("id, email, user_id, page_path, question, telegram_chat_id")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return { delivered: false, via: "none" };

  // Reply to the linked student's Telegram if known, else to the chat the
  // question came from (covers unlinked askers), else email.
  let chatId: string | null = (q.telegram_chat_id as string) ?? null;
  let email: string | null = q.email;
  if (q.user_id) {
    const { data: prof } = await svc
      .from("profiles")
      .select("telegram_chat_id, email")
      .eq("id", q.user_id)
      .maybeSingle();
    chatId = prof?.telegram_chat_id ?? chatId;
    email = email || prof?.email || null;
  }

  let delivered = false;
  let via: "telegram" | "email" | "none" = "none";
  if (chatId) {
    delivered = await sendTelegramMessage(
      chatId,
      `💬 Reply from CA Parveen Sharma:\n\nYour question: ${q.question}\n\n${text}`,
    );
    if (delivered) via = "telegram";
  }
  if (!delivered && email) {
    delivered = await sendTemplate("question_answered", email, {
      heading: "A reply to your question",
      question: q.question as string,
      answer: text,
    });
    if (delivered) via = "email";
  }

  await svc.from("page_questions").update({ status: opts.markStatus ?? "replied" }).eq("id", questionId);

  // Linked reply row so it shows in the student's own inbox for follow-up.
  if (q.user_id) {
    await svc.from("page_questions").insert({
      user_id: q.user_id,
      question: text,
      page_path: `reply:${questionId}`,
      status: "reply",
    });
  }

  try {
    await svc.from("notifications").insert({
      student_id: q.user_id ?? null,
      channel: chatId ? "whatsapp" : "email",
      template: "question_reply",
      payload: { question_id: questionId, reply: text, delivered },
      status: delivered ? "sent" : "skipped",
      sent_at: delivered ? new Date().toISOString() : null,
    });
  } catch {
    /* best-effort log */
  }

  return { delivered, via };
}
