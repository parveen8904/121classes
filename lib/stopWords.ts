// The word tests below are pure on purpose — no database, no imports — so the
// exact thing that decides whether a student is unsubscribed can be proved in a
// test without a connection. The writes pull the client in when they run.
export type Channel = "email" | "whatsapp" | "telegram";

// "STOP" HAS TO MEAN STOP, ON THE CHANNEL IT WAS SAID ON.
//
// Email got a link and a header; a chat app has neither, so the only way out a
// person has is to say so in the conversation. If nothing is listening, they
// say it, nothing happens, and the next message proves we were not listening —
// which is worse than never offering.
//
// Deliberately narrow. This fires on a message that is ONLY a stop word, not
// on one that contains it: "stop confusing me on this AS 115 question" is a
// doubt, and silently unsubscribing that student would be a bug they could
// never diagnose. A person who means it types the word and nothing else.
const WORDS = new Set([
  "stop", "unsubscribe", "unsub", "opt out", "optout", "remove me", "cancel",
  "band karo", "bandh karo", "mat bhejo", "mat bhejiye", "rok do",
]);

export function isStopWord(text: string): boolean {
  const t = String(text ?? "").trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
  if (!t || t.length > 24) return false;
  return WORDS.has(t) || WORDS.has(t.replace(/^\/+/, "")); // /stop is Telegram's own convention
}

/**
 * Record the stop and give the one confirmation they will get.
 *
 * Confirmed on purpose, and exactly once: a person who has asked to be left
 * alone and hears nothing back cannot tell whether it worked, and asks again —
 * or writes a review saying nobody listens. The confirmation is sent BEFORE the
 * block is written, because afterwards our own guard would refuse to send it.
 */
export async function honourStop(handle: string, channel: Channel, reason = "Replied STOP"): Promise<void> {
  const addr = String(handle ?? "").trim().toLowerCase();
  if (!addr) return;
  const { createServiceClient } = await import("@/lib/supabase/service");
  await createServiceClient().from("email_blocklist").upsert(
    { channel, email: addr, reason },
    { onConflict: "channel,email" },
  );
}

export const STOP_CONFIRMATION =
  "Done — we have stopped sending you messages here. Your access to classes is unaffected. "
  + "Reply START if you ever want them back.";

const START_WORDS = new Set(["start", "resume", "subscribe", "chalu karo", "shuru karo"]);

/** A door that only locks is a trap. */
export function isStartWord(text: string): boolean {
  const t = String(text ?? "").trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
  if (!t || t.length > 24) return false;
  return START_WORDS.has(t) || START_WORDS.has(t.replace(/^\/+/, ""));
}

export async function undoStop(handle: string, channel: Channel): Promise<void> {
  const addr = String(handle ?? "").trim().toLowerCase();
  if (!addr) return;
  const { createServiceClient } = await import("@/lib/supabase/service");
  await createServiceClient().from("email_blocklist")
    .delete().eq("channel", channel).eq("email", addr);
}

export const START_CONFIRMATION = "You are back on — messages will resume.";
