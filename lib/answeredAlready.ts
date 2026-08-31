/**
 * ONE QUESTION, ONE ANSWER.
 *
 * 30-31 August 2026, the CA Intermediate group. A student sent the same
 * photographed sum twice and the bot wrote the whole solution out twice:
 * Question 40 at 18:58 and again at 19:00, Question 36 at 16:02 and again at
 * 16:14. Two full worked answers each, minutes apart, in a room of 1,318
 * people. His instruction: do not repeat answers in the group.
 *
 * A student re-asks for one of three reasons — they did not see the reply, they
 * were not happy with it, or they double-sent. None of them is served by a
 * second wall of text; the first two are served by being TOLD the answer is
 * already there, and where.
 *
 * WHAT COUNTS AS THE SAME QUESTION. A photographed sum carries almost no text
 * — the caption is usually just the bot's name — so the words cannot identify
 * it. Telegram's file_unique_id can: it is stable for the same file, so the
 * same photo sent twice is recognisable without downloading or hashing it.
 * Where there is no photo, the normalised text does the job.
 */

/** Telegram's stable per-file identity, which survives a re-send. */
export function photoUniqueId(msg: unknown): string | null {
  const m = msg as Record<string, any>;
  if (Array.isArray(m?.photo) && m.photo.length) {
    return m.photo[m.photo.length - 1]?.file_unique_id ?? null;
  }
  if (m?.document && /^image\//.test(String(m.document.mime_type || ""))) {
    return m.document.file_unique_id ?? null;
  }
  return null;
}

/** Words, lower case, no punctuation, no bot tag — so "Ans to q 40" == "ans to q40". */
export function normaliseQuestion(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/@[a-z0-9_]+/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * What this question IS, for the purpose of not answering it twice.
 * A photo wins: the same picture is the same question whatever was typed with it.
 */
export function answerKey(msg: unknown, question: string): string | null {
  const photo = photoUniqueId(msg);
  if (photo) return `img:${photo}`;
  const words = normaliseQuestion(question);
  // Too short to be a question in its own right — "@bot", "ok", "?" — and
  // matching on it would silence unrelated messages.
  if (words.length < 12) return null;
  return `txt:${words}`;
}

/** A supergroup message's permalink, so the student can be sent straight to it. */
export function messageLink(chatId: string, messageId: number): string | null {
  const m = /^-100(\d+)$/.exec(String(chatId));
  return m ? `https://t.me/c/${m[1]}/${messageId}` : null;
}

export type PriorAnswer = { tgMessageId: number; at: string };

/**
 * Has this exact question already been answered in this group recently?
 *
 * Twelve hours, not forever: a student revisiting a sum next week deserves a
 * fresh answer, and a chapter genuinely re-asked days later is a new question.
 */
export async function alreadyAnswered(
  chatId: string,
  key: string | null,
  withinHours = 12,
): Promise<PriorAnswer | null> {
  if (!key) return null;
  const since = new Date(Date.now() - withinHours * 3600_000).toISOString();
  // Imported here rather than at the top so the pure matching functions above
  // can be unit-tested without dragging in a database client.
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { data } = await createServiceClient()
    .from("group_messages")
    .select("tg_message_id, created_at")
    .eq("chat_id", chatId)
    .eq("answer_key", key)
    .eq("status", "visible")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0];
  return row ? { tgMessageId: Number(row.tg_message_id), at: String(row.created_at) } : null;
}

/** The short note that replaces a second full answer. */
export function pointerReply(chatId: string, prior: PriorAnswer): string {
  const link = messageLink(chatId, prior.tgMessageId);
  return (
    "🤖 I have already answered this one just above" +
    (link ? ` — here: ${link}` : "") +
    ".\n\nIf that answer was not clear, tell me WHICH STEP lost you and I will take that step apart. " +
    "Posting the whole solution again would only bury it."
  );
}
