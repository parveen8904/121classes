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
