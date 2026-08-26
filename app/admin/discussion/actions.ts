"use server";

import { currentStaff, staffCanArea, assertArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tgDeleteMessage, tgRestrictUser, tgUnbanUser, tgMemberStatus, tgApplyRecommendedPermissions } from "@/lib/telegramGroup";
import { discordDeleteChannelMessage } from "@/lib/discord";
import { str } from "../_lib/util";

async function adminId(): Promise<string | null> {
  const staff = await currentStaff();
  return staff && staffCanArea(staff, "moderation") ? staff.id : null;
}

// Save the admin's extra blocked terms (competitor names, banned phrases) —
// one per line. Applied instantly to Telegram, Discord and website messages.
export async function saveBlockedTerms(formData: FormData) {
  await assertArea("moderation");
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
  await assertArea("moderation");
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
  await assertArea("moderation");
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
  await assertArea("moderation");
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

// UNBAN — INCLUDING IN TELEGRAM, WHICH IT NEVER DID.
//
// This deleted our own row and stopped. The person stayed banned inside the
// group and could not return however often the button was pressed, and nothing
// said so. Now the ban is actually lifted where it was applied.
export async function unbanUser(formData: FormData) {
  await assertArea("moderation");
  const me = await adminId();
  if (!me) return;
  const banId = str(formData.get("ban_id"));
  const svc = createServiceClient();
  const { data: row } = await svc
    .from("banned_group_users").select("chat_id, tg_user_id").eq("id", banId).maybeSingle();
  if (row?.tg_user_id && row?.chat_id) {
    await tgUnbanUser(String(row.chat_id), String(row.tg_user_id)).catch(() => false);
  }
  await svc.from("banned_group_users").delete().eq("id", banId);
  revalidatePath("/admin/discussion");
}

// PUT BACK EVERYONE THE OLD RULE THREW OUT.
//
// Until 26 Aug 2026 a first message from anyone whose Telegram was not linked
// to a portal account got them deleted and banned. Only 9.5% of students had
// linked, so it removed 36 people from the two study groups, at least two of
// them holding a live paid subscription, and the CA Intermediate group went
// silent. The rule is gone; this undoes what it did.
//
// It targets ONLY rows the rule itself wrote ("Not a linked student"), so a
// person the founder or a moderator banned on purpose is never touched.
export async function restoreAutoRemoved() {
  await assertArea("moderation");
  const me = await adminId();
  if (!me) return;
  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("banned_group_users")
    .select("id, chat_id, tg_user_id")
    .ilike("reason", "Not a linked student%");

  let lifted = 0;
  for (const r of rows ?? []) {
    const chat = String((r as { chat_id: string }).chat_id ?? "");
    const uid = String((r as { tg_user_id: string | null }).tg_user_id ?? "");
    if (chat && uid && (await tgUnbanUser(chat, uid).catch(() => false))) lifted++;
    await svc.from("banned_group_users").delete().eq("id", (r as { id: string }).id);
  }
  await svc.from("message_moderation_log").insert({
    message_id: null, action: "restored_auto_removed", reason: `${lifted} of ${(rows ?? []).length} lifted in Telegram`, by_admin: me,
  });
  revalidatePath("/admin/discussion");
  redirect(`/admin/discussion?done=${encodeURIComponent(
    `Ban lifted for ${lifted} of ${(rows ?? []).length} people removed by the old rule. Telegram does not put anyone back automatically — they can now rejoin, so send them the group link.`,
  )}`);
}

// REMOVE SOMEBODY BY THEIR TELEGRAM ID.
//
// The per-message ban button only reaches people whose message is still in the
// recent list. When a student reports somebody, the account being reported is
// often further up the group than that.
export async function banByTelegramId(formData: FormData) {
  await assertArea("moderation");
  const me = await adminId();
  if (!me) return;
  const chatId = str(formData.get("chat_id")).trim();
  const tgUserId = str(formData.get("tg_user_id")).trim();
  const reason = str(formData.get("reason")).trim() || "Removed by moderator";
  if (!chatId || !/^\d+$/.test(tgUserId)) {
    redirect(`/admin/discussion?done=${encodeURIComponent("Give a group and a numeric Telegram id.")}`);
  }
  const svc = createServiceClient();
  const ok = await tgRestrictUser(chatId, tgUserId, true).catch(() => false);
  await svc.from("banned_group_users").upsert(
    { chat_id: chatId, user_id: null, tg_user_id: tgUserId, kind: "ban", reason, banned_by: me },
    { onConflict: "chat_id,tg_user_id" },
  );
  await svc.from("message_moderation_log").insert({
    message_id: null, action: "banned", reason: `${reason} (tg ${tgUserId})`, by_admin: me,
  });
  revalidatePath("/admin/discussion");
  redirect(`/admin/discussion?done=${encodeURIComponent(
    ok ? `Removed ${tgUserId} from the group and banned.` : `Recorded the ban, but Telegram refused it — check the bot is still an admin there.`,
  )}`);
}

// PUT A STUDENT'S HIDDEN MESSAGES BACK ON THE RECORD.
//
// For somebody whose report of abuse was hidden by the blocked-terms list.
// Their words return to the website view and stop counting against them.
// It cannot undo the Telegram side: those messages were deleted from the group
// at the time and Telegram gives no way to restore them.
export async function unhideSenderMessages(formData: FormData) {
  await assertArea("moderation");
  const me = await adminId();
  if (!me) return;
  const chatId = str(formData.get("chat_id")).trim();
  const tgUserId = str(formData.get("tg_user_id")).trim();
  if (!chatId || !tgUserId) return;
  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("group_messages")
    .update({ status: "visible", flagged: false })
    .eq("chat_id", chatId).eq("sender_tg_id", tgUserId).eq("status", "hidden")
    .select("id");
  const status = await tgMemberStatus(chatId, tgUserId);
  await svc.from("message_moderation_log").insert({
    message_id: null, action: "unhidden_report", reason: `${(rows ?? []).length} messages restored (tg ${tgUserId})`, by_admin: me,
  });
  revalidatePath("/admin/discussion");
  redirect(`/admin/discussion?done=${encodeURIComponent(
    `${(rows ?? []).length} message(s) put back on the record. In Telegram they are gone for good — they were deleted at the time. That account is currently: ${status ?? "unknown"}.`,
  )}`);
}

// Generate a students-only (approval-required) join link for a group and store
// it where the website hands it to students — so the public "anyone can join"
// link can then be safely removed.
export async function makeStudentsOnlyLink(formData: FormData) {
  await assertArea("moderation");
  const chatId = str(formData.get("chat_id"));
  if (!chatId) return;
  const { tgCreateApprovalInviteLink } = await import("@/lib/telegramGroup");
  const link = await tgCreateApprovalInviteLink(chatId);
  const svc = createServiceClient();
  if (link) {
    await svc.from("subjects").update({ telegram_group_url: link }).eq("telegram_group_chat_id", chatId);
    revalidatePath("/admin/discussion");
    redirect(`/admin/discussion?linked=1`);
  }
  redirect(`/admin/discussion?linkerr=1`);
}


// HAND THE BEHAVIOUR POLICING BACK TO TELEGRAM.
//
// Sets the group's own permissions through the Bot API, so Telegram enforces
// them rather than us noticing afterwards. Light on purpose — see
// RECOMMENDED_PERMISSIONS for what is switched off and why.
//
// It cannot turn on Aggressive Anti-Spam: the API can read that setting and
// not write it. That one is a toggle in the Telegram app.
export async function applyGroupPermissions(formData: FormData) {
  await assertArea("moderation");
  const me = await adminId();
  if (!me) return;
  const chatId = str(formData.get("chat_id")).trim();
  if (!chatId) return;
  const ok = await tgApplyRecommendedPermissions(chatId).catch(() => false);
  await createServiceClient().from("message_moderation_log").insert({
    message_id: null,
    action: "group_permissions_applied",
    reason: ok ? `Telegram accepted the permission set for ${chatId}` : `Telegram refused the permission set for ${chatId}`,
    by_admin: me,
  });
  revalidatePath("/admin/discussion");
  redirect(`/admin/discussion?done=${encodeURIComponent(
    ok
      ? "Telegram is now enforcing the group's permissions: polls, link-preview cards, renaming the group and pinning are off for members; messages, photos, documents, voice notes, stickers and inviting friends stay on."
      : "Telegram refused the change — check the bot is still an admin with “Change group info” rights.",
  )}`);
}
