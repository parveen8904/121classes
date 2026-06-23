"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { moderateMessage } from "@/lib/moderation";
import { tgSendToGroup } from "@/lib/telegramGroup";
import { discordSendToChannel } from "@/lib/discord";

// Post a message from the website to a subject's group(s) — Telegram AND Discord,
// whichever are configured — via the bot. Stored in our DB (the source of truth).
// Moderated first: flagged messages are stored hidden and NOT relayed.
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

  const { data: subj } = await svc.from("subjects").select("telegram_group_chat_id, discord_channel_id").eq("id", input.subjectId).maybeSingle();
  const tgChat = (subj as { telegram_group_chat_id?: string | null } | null)?.telegram_group_chat_id || "";
  const dcChannel = (subj as { discord_channel_id?: string | null } | null)?.discord_channel_id || "";
  if (!tgChat && !dcChannel) return { ok: false, error: "This subject has no group yet." };

  // Muted / banned in either channel of this subject?
  const chats = [tgChat, dcChannel].filter(Boolean);
  const { data: banned } = await svc.from("banned_group_users").select("id").in("chat_id", chats).eq("user_id", user.id).maybeSingle();
  if (banned) return { ok: false, error: "You are muted in this group." };

  const { data: prof } = await svc.from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();
  const name = (prof?.full_name as string) || "Student";
  const role = (prof?.role as string) || "student";
  const label = role === "admin" || role === "faculty" ? `👨‍🏫 ${name} (Faculty)` : `👤 ${name}`;

  const mod = moderateMessage(text);
  if (mod.flagged) {
    await svc.from("group_messages").insert({
      chat_id: tgChat || dcChannel, subject_id: input.subjectId, source: "website", sender_user_id: user.id, sender_name: name,
      body: text, flagged: true, flag_reasons: mod.reasons, status: "hidden",
    });
    return { ok: false, error: `Message blocked (${mod.reasons.join(", ")}). Group chat is for study discussion only.` };
  }

  // Relay to both platforms (bot-authored → no echo loop).
  let tgMsgId: number | null = null;
  if (tgChat) tgMsgId = await tgSendToGroup(tgChat, `${label}: ${text}`);
  if (dcChannel) await discordSendToChannel(dcChannel, `${label}: ${text}`);

  await svc.from("group_messages").insert({
    chat_id: tgChat || dcChannel, subject_id: input.subjectId, source: "website", sender_user_id: user.id, sender_name: name,
    body: text, tg_message_id: tgMsgId, status: "visible",
  });
  return { ok: true };
}
