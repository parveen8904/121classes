"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { moderateMessage } from "@/lib/moderation";
import { tgSendToGroup } from "@/lib/telegramGroup";

// Post a message from the website to a subject's Telegram group (via the bot),
// storing it in our DB (source of truth). Moderated first — flagged messages are
// stored hidden and NOT sent to Telegram.
export async function postToGroup(input: { subjectId: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please log in." };
  const text = (input.text || "").trim();
  if (!text) return { ok: false, error: "Empty message." };
  if (text.length > 2000) return { ok: false, error: "Message too long (max 2000 characters)." };

  const svc = createServiceClient();

  // Student must have opted into this subject.
  const { data: opted } = await supabase.from("my_subjects").select("subject_id").eq("student_id", user.id).eq("subject_id", input.subjectId).maybeSingle();
  if (!opted) return { ok: false, error: "You're not in this group." };

  const { data: subj } = await svc.from("subjects").select("telegram_group_chat_id").eq("id", input.subjectId).maybeSingle();
  const chatId = (subj as { telegram_group_chat_id?: string | null } | null)?.telegram_group_chat_id;
  if (!chatId) return { ok: false, error: "This subject has no group yet." };

  // Muted / banned?
  const { data: banned } = await svc.from("banned_group_users").select("id").eq("chat_id", chatId).eq("user_id", user.id).maybeSingle();
  if (banned) return { ok: false, error: "You are muted in this group." };

  const { data: prof } = await svc.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const name = (prof?.full_name as string) || "Student";

  const mod = moderateMessage(text);
  if (mod.flagged) {
    await svc.from("group_messages").insert({
      chat_id: chatId, subject_id: input.subjectId, source: "website", sender_user_id: user.id, sender_name: name,
      body: text, flagged: true, flag_reasons: mod.reasons, status: "hidden",
    });
    return { ok: false, error: `Message blocked (${mod.reasons.join(", ")}). Group chat is for study discussion only.` };
  }

  const msgId = await tgSendToGroup(chatId, `${name}: ${text}`);
  await svc.from("group_messages").insert({
    chat_id: chatId, subject_id: input.subjectId, source: "website", sender_user_id: user.id, sender_name: name,
    body: text, tg_message_id: msgId, status: "visible",
  });
  return { ok: true };
}
