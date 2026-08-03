"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage } from "@/lib/notify";
import { sendTemplate } from "@/lib/emailTemplates";
import { deliverQuestionAnswer } from "@/lib/answerDelivery";

export async function markQuestionDone(formData: FormData) {
  if (!(await requireArea("inbox"))) return;
  const id = (formData.get("id") as string) || "";
  const status = (formData.get("status") as string) || "done";
  if (!id) return;
  await createServiceClient().from("page_questions").update({ status }).eq("id", id);
  revalidatePath("/admin/inbox");
}

// Reply to a question: delivers via Telegram (if the student is linked) or email,
// then marks it replied. The reply text is logged in `notifications` for record.
export async function replyToQuestion(formData: FormData) {
  if (!(await requireArea("inbox"))) return;
  const id = (formData.get("id") as string) || "";
  const reply = ((formData.get("reply") as string) || "").trim();
  if (!id || !reply) return;
  const svc = createServiceClient();

  const { data: q } = await svc
    .from("page_questions")
    .select("id, email, user_id, page_path, question, telegram_chat_id")
    .eq("id", id)
    .maybeSingle();
  if (!q) return;

  // Reply to the linked student's Telegram if known, else to the chat the
  // question was asked from (covers unlinked askers), else email.
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
  // Prefer Telegram if the question came from there or the student is linked.
  if (chatId) {
    delivered = await sendTelegramMessage(
      chatId,
      `💬 Reply from CA Parveen Sharma:\n\nYour question: ${q.question}\n\n${reply}`,
    );
  }
  if (!delivered && email) {
    delivered = await sendTemplate("question_answered", email, {
      heading: "A reply to your question",
      question: q.question,
      answer: reply,
    });
  }

  await svc.from("page_questions").update({ status: "replied" }).eq("id", id);
  // Linked reply row so it shows in the student's own inbox for follow-up.
  if (q.user_id) {
    await svc.from("page_questions").insert({
      user_id: q.user_id,
      question: reply,
      page_path: `reply:${id}`,
      status: "reply",
    });
  }
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

// Send every reply that is still sitting as a draft.
//
// Six were written under the old approve-first rule and were waiting on the
// founder; the automatic round only picks up questions it has never touched,
// so they would have waited for ever. This releases them in one press.
export async function sendAllDrafts() {
  if (!(await requireArea("inbox"))) return;
  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("page_questions")
    .select("id, draft_reply")
    .not("draft_reply", "is", null)
    .eq("status", "open")
    .limit(200);

  let sent = 0;
  let failed = 0;
  for (const r of rows ?? []) {
    const text = String(r.draft_reply ?? "").trim();
    if (!text) continue;
    const res = await deliverQuestionAnswer(String(r.id), text, { markStatus: "replied" });
    if (res.delivered) {
      await svc.from("page_questions").update({ draft_reply: null }).eq("id", r.id);
      sent++;
    } else {
      failed++;
    }
  }
  revalidatePath("/admin/inbox");
  redirect(`/admin/inbox?sent=${sent}&failed=${failed}`);
}
