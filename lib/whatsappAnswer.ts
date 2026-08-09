import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppText } from "@/lib/notify";
import { reachStudent } from "@/lib/reachStudent";
import { getRepositoryContext } from "@/lib/repository";
import { answerDoubtFromMaterial, aiConfigured, judgeStudentMessage, ABUSE_WARNING_DIRECT, NEED_FACULTY, replyFromSiteMap, PLAIN_FALLBACK } from "@/lib/ai";
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
    // The private wording: this is a one-to-one thread, not the study group.
    await sendWhatsAppText(from, ABUSE_WARNING_DIRECT).catch(() => false);
    return "warned";
  }
  // People type on WhatsApp the way they speak: "I wanna extend this batch",
  // then "I got this batch complimentary", then "4 month access". Judged one
  // line at a time, the last two look like chatter and were dropped — so the
  // student was answered halfway through their own sentence and then ignored.
  //
  // If the message alone reads as chatter but the same number wrote minutes
  // ago, the thread is judged instead of the line.
  let question2 = question;
  if (judged.kind !== "question") {
    const thread = await recentFrom(svc, from);
    if (!thread) return "ignored"; // "ok sir", "thank you" — the acknowledgement already went
    const joined = `${thread}\n${question}`;
    const rejudged = await judgeStudentMessage(joined);
    if (rejudged.kind !== "question") return "ignored";
    question2 = joined;
  }

  if (!(await aiConfigured())) return escalate(from, question2);

  // WHO is asking, before answering them.
  //
  // Every WhatsApp reply used to be written without knowing whether the person
  // had ever paid for anything. A student who could not find the case studies
  // was told where case studies live — when the true answer was that his
  // account had no plan on it at all, which no amount of study material could
  // have revealed.
  const { studentFactsByPhone, isAccountQuestion, accountAnswerRules } = await import("@/lib/studentContext");
  let material = await getRepositoryContext(null, 12000, { query: question2 });
  if (isAccountQuestion(question2)) {
    const facts = await studentFactsByPhone(from).catch(() => null);
    if (facts) material = `${accountAnswerRules(facts)}\n\n---\n\n${material}`;
  }
  // The last few turns of THIS conversation. Without it the follow-up question
  // was asked into a void: a student who had just said "CA Final" was asked
  // which course he was on, three times.
  const { whatsappHistory } = await import("@/lib/conversation");
  const history = await whatsappHistory(from, question).catch(() => "");
  const raw = await answerDoubtFromMaterial(question2, material, "doubt", { history });
  if (!raw || raw.trim() === NEED_FACULTY) return escalate(from, question2);

  // Outside the 24-hour window WhatsApp refuses the message. The answer is
  // written either way, so it goes by email rather than being thrown away.
  const out = await reachStudent(from, `${raw}\n\n— CA Parveen Sharma Classes`, "A reply to your question")
    .catch(() => ({ via: "none" as const, to: null }));
  if (out.via === "none") return escalate(from, question2);

  // Kept, so the founder can read what was asked and what went back.
  await log(svc, from, question2, raw, "answered");
  return "answered";
}

// Handed to a person — but never in silence.
//
// This used to send "our faculty will look at it and reply here shortly" and
// then nothing followed. So a real reply goes first, built from what the site
// actually has, and the founder is still told. If the student then hears from a
// person, they have had two useful messages instead of one empty one.
async function escalate(from: string, question: string): Promise<"escalated"> {
  let reply: string | null = null;
  try {
    reply = await replyFromSiteMap(question);
  } catch {
    /* falls through to the plain line below */
  }
  const text = reply ?? PLAIN_FALLBACK;

  const out = await reachStudent(from, `${text}\n\n— CA Parveen Sharma Classes`, "A reply to your question")
    .catch(() => ({ via: "none" as const, to: null }));
  await notifyFaculty(
    "A student doubt needs your reply (WhatsApp)",
    `From: ${from}\n\nQuestion:\n${question}\n\nWhat already went to the student (by ${out.via}):\n${text}\n\n` +
      (out.via === "none"
        ? "NOTHING REACHED THEM — WhatsApp is past its 24-hour window and we have no email for this number.\n\n"
        : "") +
      `Add to it from Admin → Messages → WhatsApp.`,
  ).catch(() => {});
  // Logged as what it is: an answer went, and a person still owes a better one.
  await log(createServiceClient(), from, question, text, "open");
  return "escalated";
}

// The answer used to be written as a loose row that nothing pointed at, so the
// doubt log showed the question with "no answer sent" beside it even when a full
// answer had gone out. It is now paired to its question like every other channel.
async function log(
  svc: ReturnType<typeof createServiceClient>,
  from: string,
  question: string,
  answer: string | null,
  status: string,
): Promise<void> {
  // Name the asker when the number is one we know. The phone itself is NOT put
  // in the email column — a later reply would try to send mail to a phone number.
  let userId: string | null = null;
  try {
    const digits = from.replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      const { data } = await svc
        .from("profiles")
        .select("id")
        .ilike("phone", `%${digits}`)
        .limit(1)
        .maybeSingle();
      userId = (data?.id as string) ?? null;
    }
  } catch { /* an unknown number is still worth logging */ }

  const { logAiExchange } = await import("@/lib/aiAnswerLog");
  await logAiExchange({ channel: "whatsapp", question, answer, status, userId });
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

/**
 * The last few things this number said, within the hour.
 *
 * Only used to rescue a fragment that means nothing on its own. Returns null
 * when there is no recent history, so a lone "Hi" is still left alone.
 */
async function recentFrom(
  svc: ReturnType<typeof createServiceClient>,
  from: string,
  withinMinutes = 60,
): Promise<string | null> {
  try {
    const { data } = await svc
      .from("notifications")
      .select("payload")
      .eq("channel", "whatsapp")
      .eq("template", "inbound")
      .order("id", { ascending: false })
      .limit(40);

    const cutoff = Date.now() - withinMinutes * 60_000;
    const lines: string[] = [];
    for (const r of data ?? []) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      if (String(p.from ?? "") !== from) continue;
      const at = Number(p.timestamp ?? p.ts ?? 0) * 1000;
      if (!at || at < cutoff) continue;
      const body = String((p.text as { body?: string } | undefined)?.body ?? "").trim();
      if (body) lines.push(body);
      if (lines.length >= 5) break;
    }
    // The newest is the message we are already handling.
    const earlier = lines.slice(1).reverse();
    return earlier.length ? earlier.join("\n") : null;
  } catch {
    return null;
  }
}
