import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppText } from "@/lib/notify";
import { getRepositoryContext } from "@/lib/repository";
import { answerDoubtFromMaterial, aiConfigured, judgeStudentMessage, ABUSE_WARNING, NEED_FACULTY } from "@/lib/ai";
import { notifyFaculty } from "@/lib/notify";

// Answer a WhatsApp doubt the way Telegram already does.
//
// The marketing says a student can ask a question any time. On Telegram that is
// true: a student messages the bot directly and the AI answers from CA Parveen
// Sharma's own material, no group to join. On WhatsApp it was NOT true — every
// message got the same canned acknowledgement and then waited for a human.
//
// The business number is live on the Cloud API and verified, so nothing was
// blocking this except that nobody had wired the brain to it. A reply inside
// the 24-hour customer service window costs nothing.
//
// Rules kept from the rest of the system:
//   • chatter and abuse are not answered — a warning goes to the abusive, and
//     the second offence is recorded for blocking;
//   • an answer the AI cannot give from the material goes to the faculty
//     instead of being invented;
//   • NEVER on his personal line. That one drafts only, and he presses send.

export async function answerWhatsAppDoubt(from: string, text: string): Promise<"answered" | "escalated" | "warned" | "ignored"> {
  const question = (text ?? "").trim();
  if (!question) return "ignored";

  const svc = createServiceClient();

  // "My paper has not been checked" gets the route, not a study answer — the
  // AI cannot mark a copy it has not been given, and a general reply to this
  // reads as though nobody understood the question.
  const { isEvaluationComplaint, EVALUATION_HELP } = await import("@/lib/evaluationHelp");
  if (isEvaluationComplaint(question)) {
    await sendWhatsAppText(from, EVALUATION_HELP).catch(() => false);
    await log(svc, from, question, EVALUATION_HELP, "answered");
    return "answered";
  }

  // Is this worth answering at all?
  const judged = await judgeStudentMessage(question);
  if (judged.kind === "abusive") {
    await recordWarning(svc, from, question);
    await sendWhatsAppText(from, ABUSE_WARNING).catch(() => false);
    return "warned";
  }
  if (judged.kind !== "question") return "ignored"; // "ok sir", "thank you" — the acknowledgement already went

  if (!(await aiConfigured())) return escalate(from, question);

  const material = await getRepositoryContext(null, 12000, { query: question });
  const raw = await answerDoubtFromMaterial(question, material);
  if (!raw || raw.trim() === NEED_FACULTY) return escalate(from, question);

  const sent = await sendWhatsAppText(from, `${raw}\n\n— CA Parveen Sharma Classes`).catch(() => false);
  if (!sent) return escalate(from, question);

  // Kept, so the founder can read what was asked and what went back.
  await log(svc, from, question, raw, "answered");
  return "answered";
}

async function escalate(from: string, question: string): Promise<"escalated"> {
  await sendWhatsAppText(
    from,
    "✅ Got your question. Our faculty will look at it and reply here shortly.",
  ).catch(() => false);
  await notifyFaculty(
    "A student doubt needs your reply (WhatsApp)",
    `From: ${from}\n\nQuestion:\n${question}\n\nReply from Admin → Messages → WhatsApp.`,
  ).catch(() => {});
  await log(createServiceClient(), from, question, null, "open");
  return "escalated";
}

async function log(
  svc: ReturnType<typeof createServiceClient>,
  from: string,
  question: string,
  answer: string | null,
  status: string,
): Promise<void> {
  try {
    await svc.from("page_questions").insert({
      user_id: null,
      page_path: "whatsapp",
      question,
      status,
    });
    if (answer) {
      await svc.from("page_questions").insert({
        user_id: null,
        page_path: "whatsapp",
        question: answer,
        status: "answer",
      });
    }
  } catch { /* the reply matters more than the log */ }
}

async function recordWarning(
  svc: ReturnType<typeof createServiceClient>,
  from: string,
  text: string,
): Promise<void> {
  try {
    // The table is keyed by chat_id and shared with Telegram; a WhatsApp
    // sender is stored as wa:<number> so the two cannot collide.
    const key = `wa:${from}`;
    const { data: existing } = await svc
      .from("abuse_warnings")
      .select("warnings")
      .eq("chat_id", key)
      .maybeSingle();
    await svc.from("abuse_warnings").upsert(
      {
        chat_id: key,
        warnings: (Number(existing?.warnings) || 0) + 1,
        last_at: new Date().toISOString(),
        last_text: text.slice(0, 500),
      },
      { onConflict: "chat_id" },
    );
  } catch { /* table optional */ }
}
