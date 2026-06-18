"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailShell, sendTelegramMessage } from "@/lib/notify";

export async function markQuestionDone(formData: FormData) {
  const id = (formData.get("id") as string) || "";
  const status = (formData.get("status") as string) || "done";
  if (!id) return;
  await createServiceClient().from("page_questions").update({ status }).eq("id", id);
  revalidatePath("/admin/inbox");
}

// Reply to a question: delivers via Telegram (if the student is linked) or email,
// then marks it replied. The reply text is logged in `notifications` for record.
export async function replyToQuestion(formData: FormData) {
  const id = (formData.get("id") as string) || "";
  const reply = ((formData.get("reply") as string) || "").trim();
  if (!id || !reply) return;
  const svc = createServiceClient();

  const { data: q } = await svc
    .from("page_questions")
    .select("id, email, user_id, page_path, question")
    .eq("id", id)
    .maybeSingle();
  if (!q) return;

  let chatId: string | null = null;
  let email: string | null = q.email;
  if (q.user_id) {
    const { data: prof } = await svc
      .from("profiles")
      .select("telegram_chat_id, email")
      .eq("id", q.user_id)
      .maybeSingle();
    chatId = prof?.telegram_chat_id ?? null;
    email = email || prof?.email || null;
  }

  let delivered = false;
  // Prefer Telegram if the question came from there or the student is linked.
  if (chatId) {
    delivered = await sendTelegramMessage(
      chatId,
      `💬 Reply from CA Parveen Sharma's team:\n\nYour question: ${q.question}\n\n${reply}`,
    );
  }
  if (!delivered && email) {
    const html = emailShell(
      "A reply to your question",
      `<p>You asked:</p><blockquote style="color:#475569">${q.question}</blockquote><p>${reply.replace(/\n/g, "<br/>")}</p>`,
    );
    delivered = await sendEmail(email, "Your question — 121 CA Classes", html);
  }

  await svc.from("page_questions").update({ status: "replied" }).eq("id", id);
  try {
    await svc.from("notifications").insert({
      student_id: q.user_id ?? null,
      channel: chatId ? "whatsapp" : "email",
      template: "question_reply",
      payload: { question_id: id, reply, delivered },
      status: delivered ? "sent" : "skipped",
      sent_at: delivered ? new Date().toISOString() : null,
    });
  } catch {
    /* best-effort log */
  }
  revalidatePath("/admin/inbox");
}
