"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { telegramBotUsername } from "@/lib/notify";

// Returns a personal Telegram deep link the student taps once to connect their
// account to the bot. We never auto-add anyone — this is their own tap.
export async function ensureTelegramLink(): Promise<{
  configured: boolean;
  linked: boolean;
  url?: string;
}> {
  const bot = telegramBotUsername();
  if (!bot) return { configured: false, linked: false };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { configured: true, linked: false };

  const { data: prof } = await supabase
    .from("profiles")
    .select("telegram_chat_id, telegram_link_code")
    .eq("id", user.id)
    .maybeSingle();

  if (prof?.telegram_chat_id) return { configured: true, linked: true };

  let code = prof?.telegram_link_code;
  if (!code) {
    code = randomUUID().replace(/-/g, "");
    await supabase.from("profiles").update({ telegram_link_code: code }).eq("id", user.id);
  }
  return { configured: true, linked: false, url: `https://t.me/${bot}?start=${code}` };
}
