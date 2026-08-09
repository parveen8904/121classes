import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// WHEN A CONVERSATION IS FINISHED, AND WHAT TO SAY THEN.
//
// The founder wants students pointed at the apps, asked for a review if they
// are happy, and asked for feedback — but not on every message. Stapling that
// to the bottom of every answer would turn a helpful reply into an
// advertisement, and by the third one nobody reads past the first line.
//
// So it goes out ONCE, when the exchange has actually ended: they said thanks,
// or said it was clear, or simply asked nothing further. Judged by the model,
// because "ok got it 🙏" and "ok but what about the second part" look identical
// to a rule.
//
// Three guards keep it from becoming a nuisance:
//   • once per student per fortnight, whatever happens;
//   • never after a message that went unanswered — asking for a review from
//     somebody we just failed is worse than saying nothing;
//   • never on a conversation about distress, a refund, or anything unresolved.

const EVERY_DAYS = 14;

/** Has this student had the closing note recently? */
async function askedRecently(who: string): Promise<boolean> {
  try {
    const svc = createServiceClient();
    const since = new Date(Date.now() - EVERY_DAYS * 86400_000).toISOString();
    const { data } = await svc
      .from("notifications")
      .select("id")
      .eq("template", "conversation_close")
      .gte("sent_at", since)
      .contains("payload", { who })
      .limit(1);
    return Boolean(data?.length);
  } catch {
    // If we cannot tell, assume yes. A missed invitation costs nothing; a
    // repeated one costs their patience.
    return true;
  }
}

/**
 * Does this exchange look finished?
 *
 * Only asked when there IS an exchange to judge — a single question with an
 * answer is not a conversation that has run its course, it is one that has just
 * started.
 */
export async function conversationEnded(history: string, latest: string): Promise<boolean> {
  if (!history.trim()) return false;
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return false;

  try {
    const { judgeConversationEnded } = await import("@/lib/ai");
    return await judgeConversationEnded(history, latest);
  } catch {
    return false;
  }
}

/**
 * The note itself: the apps, a review if they are happy, and the feedback form.
 *
 * Written to be easy to ignore. It comes after their answer, never instead of
 * it, and it asks rather than insists.
 */
export async function closingNote(): Promise<string> {
  const svc = createServiceClient();
  let ios = "";
  let android = "";
  try {
    const { data } = await svc
      .from("site_settings")
      .select("key, value")
      .in("key", ["app_url_ios", "app_url_android"]);
    const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "")]));
    ios = m.get("app_url_ios") ?? "";
    android = m.get("app_url_android") ?? "";
  } catch { /* the note still works without them */ }

  const lines: string[] = ["Glad that helped. Two small things before you go:"];

  if (ios || android) {
    lines.push("");
    lines.push("📱 The classes work offline in our app — download once, watch anywhere:");
    if (android) lines.push(`Android: ${android}`);
    if (ios) lines.push(`iPhone: ${ios}`);
    lines.push("");
    // Only asked of somebody we have just helped, which is the only honest
    // moment to ask.
    lines.push("If it has been useful to you, a review on the store genuinely helps other CA students find us.");
  }

  lines.push("");
  lines.push("📝 And if you have two minutes, tell us what to improve: caparveensharma.com/feedback");
  lines.push("");
  lines.push("— CA Parveen Sharma Classes");
  return lines.join("\n");
}

/** Remember that we asked, so nobody is asked twice in a fortnight. */
export async function noteClosingSent(who: string, channel: string): Promise<void> {
  try {
    await createServiceClient().from("notifications").insert({
      student_id: null,
      channel: channel === "telegram" ? "telegram" : "whatsapp",
      template: "conversation_close",
      payload: { who, channel },
      status: "sent",
      sent_at: new Date().toISOString(),
    });
  } catch { /* best effort */ }
}

/**
 * The whole decision in one call: should the closing note go, and what is it?
 * Returns null when it should not.
 */
export async function maybeClosingNote(opts: {
  who: string;
  channel: string;
  history: string;
  latest: string;
}): Promise<string | null> {
  const { who, channel, history, latest } = opts;
  if (!who) return null;
  if (await askedRecently(who)) return null;
  if (!(await conversationEnded(history, latest))) return null;

  const note = await closingNote();
  await noteClosingSent(who, channel);
  return note;
}
