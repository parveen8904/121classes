"use server";

import { currentStaff, staffCanArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tgDeleteMessage, tgRestrictUser } from "@/lib/telegramGroup";
import { discordDeleteChannelMessage } from "@/lib/discord";
import { str } from "../_lib/util";

async function adminId(): Promise<string | null> {
  const staff = await currentStaff();
  return staff && staffCanArea(staff, "moderation") ? staff.id : null;
}

// Save the admin's extra blocked terms (competitor names, banned phrases) —
// one per line. Applied instantly to Telegram, Discord and website messages.
export async function saveBlockedTerms(formData: FormData) {
  const me = await adminId();
  if (!me) return;
  const terms = String(formData.get("terms") ?? "")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  await createServiceClient()
    .from("site_settings")
    .upsert({ key: "moderation_blocked_terms", value: terms }, { onConflict: "key" });
  revalidatePath("/admin/discussion");
}

// Approve a hidden/flagged message → make it visible again.
export async function restoreMessage(formData: FormData) {
  const me = await adminId();
  if (!me) return;
  const id = str(formData.get("id"));
  const svc = createServiceClient();
  await svc.from("group_messages").update({ status: "visible", flagged: false }).eq("id", id);
  await svc.from("message_moderation_log").insert({ message_id: id, action: "restored", by_admin: me });
  revalidatePath("/admin/discussion");
}

// Hide a message on the site + delete it from Telegram (if it's still there).
export async function hideMessage(formData: FormData) {
  const me = await adminId();
  if (!me) return;
  const id = str(formData.get("id"));
  const svc = createServiceClient();
  const { data: m } = await svc.from("group_messages").select("chat_id, tg_message_id, source").eq("id", id).maybeSingle();
  if (m?.tg_message_id) {
    if (m.source === "discord") await discordDeleteChannelMessage(m.chat_id as string, String(m.tg_message_id));
    else await tgDeleteMessage(m.chat_id as string, Number(m.tg_message_id));
  }
  await svc.from("group_messages").update({ status: "hidden" }).eq("id", id);
  await svc.from("message_moderation_log").insert({ message_id: id, action: "deleted", reason: "removed by admin", by_admin: me });
  revalidatePath("/admin/discussion");
}

// Ban or mute the sender of a message (in that group).
export async function banSender(formData: FormData) {
  const me = await adminId();
  if (!me) return;
  const id = str(formData.get("id"));
  const kind = str(formData.get("kind")) === "ban" ? "ban" : "mute";
  const svc = createServiceClient();
  const { data: m } = await svc.from("group_messages").select("chat_id, sender_user_id, sender_tg_id, sender_name").eq("id", id).maybeSingle();
  if (!m) return;
  const conflict = m.sender_tg_id ? "chat_id,tg_user_id" : "chat_id,user_id";
  await svc.from("banned_group_users").upsert(
    { chat_id: m.chat_id, user_id: m.sender_user_id, tg_user_id: m.sender_tg_id, kind, reason: (m.sender_name as string) || null, banned_by: me },
    { onConflict: conflict },
  );
  if (m.sender_tg_id) await tgRestrictUser(m.chat_id as string, m.sender_tg_id as string, kind === "ban");
  await svc.from("message_moderation_log").insert({ message_id: id, action: kind === "ban" ? "banned" : "muted", reason: (m.sender_name as string) || null, by_admin: me });
  revalidatePath("/admin/discussion");
}

export async function unbanUser(formData: FormData) {
  const me = await adminId();
  if (!me) return;
  const banId = str(formData.get("ban_id"));
  await createServiceClient().from("banned_group_users").delete().eq("id", banId);
  revalidatePath("/admin/discussion");
}
