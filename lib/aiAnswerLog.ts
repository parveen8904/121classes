import { createServiceClient } from "@/lib/supabase/service";

// One place where an AI exchange is written down, whatever channel it happened on.
//
// The answers were being recorded four different ways: Telegram DMs paired the
// answer to the question, but only when the asker was a linked student; WhatsApp
// wrote the answer as a loose row nothing pointed at; the study groups and
// Discord wrote nothing at all. So the doubt log — and any report built on it —
// showed a fraction of what the AI had actually said in his name.
//
// Everything now goes through here and lands in the shape the doubt log already
// understands: the question as its own row tagged with the channel, and the
// answer as a row whose page_path is "reply:<question id>". Pairing works
// whether or not we know who asked.

/** The channels the AI can answer on. The value is what shows on the report. */
export const AI_CHANNELS: Record<string, string> = {
  email: "Email",
  telegram: "Telegram (direct)",
  telegram_group: "Telegram study group",
  whatsapp: "WhatsApp",
  discord: "Discord",
  site: "Website — Ask a doubt",
  website_ticket: "Support ticket (website)",
  instagram: "Instagram comment",
  facebook: "Facebook comment",
  class_doubt: "Asked inside a class",
  "login-help": "Login help",
  group_doubt: "Study group",
};

export function channelLabel(path: string | null | undefined): string {
  const key = String(path ?? "").trim();
  return AI_CHANNELS[key] ?? (key || "Website");
}

export async function logAiExchange(opts: {
  /** One of AI_CHANNELS — becomes page_path on the question row. */
  channel: string;
  question: string;
  /** null when the AI stayed silent or handed over to a person. */
  answer: string | null;
  userId?: string | null;
  email?: string | null;
  telegramChatId?: string | null;
  /** Status for the question row; defaults to answered/open by whether there is an answer. */
  status?: string;
}): Promise<string | null> {
  const question = (opts.question ?? "").trim();
  if (!question) return null;
  const answer = (opts.answer ?? "").trim();

  try {
    const svc = createServiceClient();
    const { data: asked } = await svc
      .from("page_questions")
      .insert({
        user_id: opts.userId ?? null,
        email: opts.email ?? null,
        page_path: opts.channel,
        question,
        status: opts.status ?? (answer ? "answered" : "open"),
        telegram_chat_id: opts.telegramChatId ?? null,
      })
      .select("id")
      .single();

    if (answer && asked?.id) {
      await svc.from("page_questions").insert({
        // Carrying the asker through means the answer also shows in their own
        // inbox for a follow-up, exactly as a hand-written reply does.
        user_id: opts.userId ?? null,
        question: answer,
        page_path: `reply:${asked.id}`,
        status: "reply",
      });
    }
    return (asked?.id as string) ?? null;
  } catch {
    // The student's answer matters more than our record of it.
    return null;
  }
}
