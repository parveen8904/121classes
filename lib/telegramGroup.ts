import { getSecret } from "@/lib/secrets";

// Thin Telegram Bot API helpers for group chat (send / delete / restrict).
// The bot must be an ADMINISTRATOR in the group for delete/restrict to work.
async function tgApi(method: string, params: Record<string, unknown>): Promise<{ ok: boolean; result?: { message_id?: number } } | null> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
    });
    return await res.json();
  } catch {
    return null;
  }
}

// Returns the Telegram message_id (to store + later delete), or null.
export async function tgSendToGroup(chatId: string, text: string): Promise<number | null> {
  const j = await tgApi("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  return j?.ok && j.result?.message_id ? j.result.message_id : null;
}

// Send as a THREADED reply to a specific group message (used for AI answers, so
// the answer visibly attaches to the student's question). Returns message_id.
export async function tgSendGroupReply(chatId: string, text: string, replyToMessageId: number): Promise<number | null> {
  const j = await tgApi("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true },
  });
  return j?.ok && j.result?.message_id ? j.result.message_id : null;
}

export async function tgDeleteMessage(chatId: string, messageId: number): Promise<boolean> {
  const j = await tgApi("deleteMessage", { chat_id: chatId, message_id: messageId });
  return !!j?.ok;
}

// Approve / decline a pending join request (group must have "Approve new
// members" turned on; the bot must be a group admin). Used to keep the subject
// groups exclusive to linked portal students.
export async function tgApproveJoin(chatId: string, tgUserId: string): Promise<boolean> {
  const j = await tgApi("approveChatJoinRequest", { chat_id: chatId, user_id: Number(tgUserId) });
  return !!j?.ok;
}
export async function tgDeclineJoin(chatId: string, tgUserId: string): Promise<boolean> {
  const j = await tgApi("declineChatJoinRequest", { chat_id: chatId, user_id: Number(tgUserId) });
  return !!j?.ok;
}

// Mute (restrict to no permissions) or ban a Telegram user in a group.
export async function tgRestrictUser(chatId: string, tgUserId: string, ban = false): Promise<boolean> {
  if (ban) {
    const j = await tgApi("banChatMember", { chat_id: chatId, user_id: Number(tgUserId) });
    return !!j?.ok;
  }
  const j = await tgApi("restrictChatMember", {
    chat_id: chatId,
    user_id: Number(tgUserId),
    permissions: { can_send_messages: false },
  });
  return !!j?.ok;
}

// ── Media moderation helpers ────────────────────────────────────────────────
//
// The group moderator was text-only: an explicit PHOTO or VIDEO with no caption
// slipped straight through. These let the webhook pull the image bytes (or a
// video/sticker's thumbnail) so it can be checked by AI vision.

/** Any media on this message that could hide explicit content. */
export function messageHasMedia(msg: unknown): boolean {
  const m = msg as Record<string, unknown>;
  return !!(m?.photo || m?.sticker || m?.video || m?.animation || m?.document || m?.video_note);
}

/** The file_id of a still image to moderate — the photo itself, or a video /
 *  animation / sticker's thumbnail. Null when there's nothing image-like. */
export function moderatableImageId(msg: unknown): string | null {
  const m = msg as Record<string, any>;
  if (Array.isArray(m?.photo) && m.photo.length) return m.photo[m.photo.length - 1]?.file_id ?? null;
  if (m?.sticker) return m.sticker.thumbnail?.file_id || m.sticker.thumb?.file_id || ((m.sticker.is_animated || m.sticker.is_video) ? null : m.sticker.file_id) || null;
  if (m?.video) return m.video.thumbnail?.file_id || m.video.thumb?.file_id || null;
  if (m?.video_note) return m.video_note.thumbnail?.file_id || m.video_note.thumb?.file_id || null;
  if (m?.animation) return m.animation.thumbnail?.file_id || m.animation.thumb?.file_id || null;
  if (m?.document) {
    const mime = String(m.document.mime_type || "");
    if (/^image\//.test(mime)) return m.document.file_id;
    if (/^video\//.test(mime)) return m.document.thumbnail?.file_id || m.document.thumb?.file_id || null;
  }
  return null;
}

/** Download a Telegram file by id → base64 + an image media type for AI vision. */
export async function tgGetImageB64(fileId: string): Promise<{ b64: string; mediaType: string } | null> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) return null;
  try {
    const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, { cache: "no-store" }).then((r) => r.json());
    const path = meta?.result?.file_path as string | undefined;
    if (!path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null; // moderation runs on thumbnails; skip anything huge
    const ext = (path.split(".").pop() || "jpg").toLowerCase();
    const mediaType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
    return { b64: buf.toString("base64"), mediaType };
  } catch { return null; }
}

// Is the bot actually able to police a group? It needs to be an ADMINISTRATOR
// with delete + restrict rights, or it can detect bad content but not remove it.
// Checks each chat via getChatMember on the bot's own id.
export async function botGroupStatus(chatIds: string[]): Promise<Record<string, { present: boolean; admin: boolean; canDelete: boolean; canBan: boolean; note: string }>> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  const out: Record<string, { present: boolean; admin: boolean; canDelete: boolean; canBan: boolean; note: string }> = {};
  const blank = (note: string) => ({ present: false, admin: false, canDelete: false, canBan: false, note });
  if (!token) { for (const c of chatIds) out[c] = blank("bot token not set"); return out; }
  let botId: number | null = null;
  try {
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store", signal: AbortSignal.timeout(3000) }).then((r) => r.json());
    botId = me?.result?.id ?? null;
  } catch { /* handled below */ }
  if (!botId) { for (const c of chatIds) out[c] = blank("could not reach Telegram"); return out; }
  // All groups checked IN PARALLEL with a short timeout — a sequential loop with
  // a 6s timeout each made the moderation page hang for many seconds.
  await Promise.all(chatIds.map(async (chat) => {
    try {
      const m = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chat)}&user_id=${botId}`, { cache: "no-store", signal: AbortSignal.timeout(3000) }).then((r) => r.json());
      if (!m?.ok) { out[chat] = blank(m?.description || "not in group"); return; }
      const st = m.result?.status as string;
      const present = st !== "left" && st !== "kicked";
      const admin = st === "administrator" || st === "creator";
      out[chat] = {
        present,
        admin,
        canDelete: admin && (st === "creator" || m.result?.can_delete_messages === true),
        canBan: admin && (st === "creator" || m.result?.can_restrict_members === true),
        note: !present ? "bot is NOT in this group" : !admin ? "bot is in the group but NOT an admin" : "",
      };
    } catch { out[chat] = blank("check failed"); }
  }));
  return out;
}

// Is this Telegram user an admin/creator of the group? Used so the students-only
// backstop never touches the founder or a faculty member running the group,
// even if they have not linked their account on the website.
export async function tgIsGroupAdmin(chatId: string, userId: string): Promise<boolean> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) return false;
  try {
    const m = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`, { cache: "no-store", signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    const st = m?.result?.status;
    return st === "administrator" || st === "creator";
  } catch { return false; }
}

// Create a PRIVATE, approval-required invite link for a group. Anyone who opens
// it must REQUEST to join, which routes through the students-only gate — the bot
// approves linked students and declines everyone else. Replaces the public
// "anyone can join" link the website used to hand out. Needs the bot to be an
// admin with "invite users" rights.
export async function tgCreateApprovalInviteLink(chatId: string, name = "Website — students only"): Promise<string | null> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, name, creates_join_request: true }),
      cache: "no-store",
    }).then((r) => r.json());
    return res?.ok ? (res.result?.invite_link as string) : null;
  } catch { return null; }
}
