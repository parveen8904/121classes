import { createServiceClient } from "@/lib/supabase/service";

// WHAT WAS ALREADY SAID.
//
// A student sent four messages in one minute — "CA Final", "Ca final",
// "Financial Instruments" — and was asked "Are you doing CA Final or CA
// Intermediate?" after each one. They had answered it three times. Another was
// told "I think your message got cut off" when he wrote "Bro I already told you
// that", because as far as the reply was concerned, he hadn't.
//
// Every message was answered on its own. The judgement of whether a line was
// chatter could see the thread, but the ANSWER never did — so the follow-up
// question I added has been asked into a void.
//
// This hands the last few turns to the answer. Short on purpose: enough to
// remember what they told us, not enough to drown the study material or to cost
// money on every doubt.

const TURNS = 6;
const WITHIN_MINUTES = 120;

/**
 * Drop the message being answered, if it is sitting at the end.
 *
 * WhatsApp records an inbound message BEFORE the answer is written, Telegram
 * records it AFTER. So one of them has the current question in this list and
 * the other does not, and simply removing the last student line would be right
 * for one channel and would silently eat a turn of history on the other.
 * Matching the text works for both.
 */
function dropCurrent(
  rows: { who: "student" | "us"; text: string }[],
  current: string,
): { who: "student" | "us"; text: string }[] {
  const want = (current ?? "").trim();
  if (!want) return rows;
  const last = rows[rows.length - 1];
  if (last && last.who === "student" && last.text.trim() === want) return rows.slice(0, -1);
  return rows;
}

/** A compact transcript the model can read, or "" when there is no history. */
function transcript(lines: { who: "student" | "us"; text: string }[]): string {
  const useful = lines.filter((l) => l.text.trim()).slice(-TURNS);
  if (useful.length < 1) return "";
  return (
    "CONVERSATION SO FAR (oldest first — the newest student message is the one to answer):\n" +
    useful.map((l) => `  ${l.who === "student" ? "Student" : "You"}: ${l.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n")
  );
}

/**
 * WhatsApp: read from the message record itself, because the person may not
 * have an account here and there would be nothing to key on.
 */
export async function whatsappHistory(from: string, current: string): Promise<string> {
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("notifications")
      .select("template, payload, sent_at")
      .eq("channel", "whatsapp")
      .in("template", ["inbound", "outbound"])
      .order("id", { ascending: false })
      .limit(80);

    const cutoff = Date.now() - WITHIN_MINUTES * 60_000;
    const rows: { at: number; who: "student" | "us"; text: string }[] = [];
    for (const r of data ?? []) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const inbound = r.template === "inbound";
      const who = String((inbound ? p.from : p.to) ?? "");
      if (who !== from) continue;

      // Inbound carries WhatsApp's own timestamp; our sends carry sent_at.
      const at = inbound
        ? Number(p.timestamp ?? p.ts ?? 0) * 1000
        : r.sent_at ? new Date(String(r.sent_at)).getTime() : 0;
      if (!at || at < cutoff) continue;

      const text = String((p.text as { body?: string } | undefined)?.body ?? "").trim();
      if (!text) continue;
      rows.push({ at, who: inbound ? "student" : "us", text });
    }
    rows.sort((a, b) => a.at - b.at);
    return transcript(dropCurrent(rows, current));
  } catch {
    return "";
  }
}

/**
 * Telegram and the website: the answered log already holds both sides — the
 * question as its own row, the answer as "reply:<question id>".
 */
export async function loggedHistory(opts: {
  channel: string;
  userId?: string | null;
  telegramChatId?: string | null;
  /** The message being answered right now, so it is not quoted back as history. */
  current: string;
}): Promise<string> {
  const { channel, userId, telegramChatId, current } = opts;
  if (!userId && !telegramChatId) return "";
  try {
    const svc = createServiceClient();
    let q = svc
      .from("page_questions")
      .select("id, question, created_at")
      .eq("page_path", channel)
      .gte("created_at", new Date(Date.now() - WITHIN_MINUTES * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(TURNS);
    q = telegramChatId ? q.eq("telegram_chat_id", telegramChatId) : q.eq("user_id", userId as string);

    const { data: asked } = await q;
    const questions = (asked ?? []).slice().reverse() as { id: string; question: string; created_at: string }[];
    if (!questions.length) return "";

    const { data: replies } = await svc
      .from("page_questions")
      .select("page_path, question")
      .in("page_path", questions.map((x) => `reply:${x.id}`));
    const answerFor = new Map(
      (replies ?? []).map((r) => [String(r.page_path).replace("reply:", ""), String(r.question)]),
    );

    const rows: { who: "student" | "us"; text: string }[] = [];
    for (const x of questions) {
      rows.push({ who: "student", text: x.question });
      const a = answerFor.get(x.id);
      if (a) rows.push({ who: "us", text: a });
    }
    return transcript(dropCurrent(rows, current));
  } catch {
    return "";
  }
}
