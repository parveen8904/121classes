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

/** Delete the ticked questions. Rubbish in the inbox is just noise. */
export async function deleteSelectedQuestions(formData: FormData) {
  if (!(await requireArea("inbox"))) return;
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) redirect("/admin/inbox?deleted=0");

  const svc = createServiceClient();
  // Take the linked reply rows with them, so a deleted question does not leave
  // an orphaned answer behind in the log.
  await svc.from("page_questions").delete().in("page_path", ids.map((id) => `reply:${id}`));
  await svc.from("page_questions").delete().in("id", ids);

  revalidatePath("/admin/inbox");
  redirect(`/admin/inbox?deleted=${ids.length}`);
}

/** Mark the ticked questions done in one go. */
export async function markSelectedDone(formData: FormData) {
  if (!(await requireArea("inbox"))) return;
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) redirect("/admin/inbox?done=0");
  await createServiceClient().from("page_questions").update({ status: "done" }).in("id", ids);
  revalidatePath("/admin/inbox");
  redirect(`/admin/inbox?done=${ids.length}`);
}

/**
 * Write a suggested answer under a doubt, ready to read, edit and send.
 *
 * Nothing reaches the student from here. It fills the same draft box a person
 * would type into, using the same repository path every other channel uses —
 * so the suggestion cites his own classes and notes, and obeys the lessons
 * taught in AI training.
 */
async function draftOne(svc: ReturnType<typeof createServiceClient>, id: string, question: string): Promise<boolean> {
  const [{ getRepositoryContext }, ai] = await Promise.all([
    import("@/lib/repository"),
    import("@/lib/ai"),
  ]);
  const { answerDoubtFromMaterial, aiConfigured, judgeStudentMessage, NEED_FACULTY } = ai;
  if (!(await aiConfigured())) return false;

  // Not everything in an inbox is a question. Drafting a technical answer to
  // "thanks sir" wastes money and puts something faintly ridiculous in front
  // of whoever opens it next.
  const judged = await judgeStudentMessage(question);
  if (judged.kind !== "question") return false;

  const material = await getRepositoryContext(null, 24000, { query: question });
  // betaNote false: this is read and sent by a person, so it carries no
  // machine disclaimer — by the time a student sees it, it is his answer.
  const answer = await answerDoubtFromMaterial(question, material, "doubt", { betaNote: false });
  if (!answer || answer.trim() === NEED_FACULTY) return false;

  await svc.from("page_questions")
    .update({ draft_reply: answer, drafted_at: new Date().toISOString() })
    .eq("id", id);
  return true;
}

/** One doubt, on demand. */
export async function suggestAnswer(formData: FormData) {
  if (!(await requireArea("inbox"))) return;
  const id = (formData.get("id") as string) || "";
  if (!id) return;
  const svc = createServiceClient();
  const { data: q } = await svc.from("page_questions").select("question").eq("id", id).maybeSingle();
  if (q?.question) await draftOne(svc, id, String(q.question));
  revalidatePath("/admin/inbox");
}

/**
 * Every open doubt that has no draft yet.
 *
 * Capped and time-bounded: a server action has a deadline, and a run that dies
 * halfway leaves the ones it managed — pressing again picks up the rest, which
 * is better than one long request that fails and saves nothing.
 */
export async function suggestAllOpen() {
  if (!(await requireArea("inbox"))) return;
  const svc = createServiceClient();
  const deadline = Date.now() + 45_000;

  const { data: rows } = await svc
    .from("page_questions")
    .select("id, question")
    .eq("status", "open")
    .is("draft_reply", null)
    .order("created_at", { ascending: true })
    .limit(25);

  let done = 0;
  for (const r of rows ?? []) {
    if (Date.now() > deadline) break;
    try { if (await draftOne(svc, String(r.id), String(r.question ?? ""))) done++; }
    catch { /* one bad doubt must not stop the rest */ }
  }
  revalidatePath("/admin/inbox");
  redirect(`/admin/inbox?drafted=${done}`);
}
