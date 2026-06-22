import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramChannel, sendTelegramMessage } from "@/lib/notify";

// Post to ONE subject's linked Telegram group (no-op if not linked).
export async function postToSubjectGroup(subjectId: string, text: string, link?: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc.from("subjects").select("telegram_group_chat_id").eq("id", subjectId).maybeSingle();
  const chat = (data?.telegram_group_chat_id as string) || "";
  if (!chat) return false;
  return sendTelegramMessage(chat, text, link);
}

// Auto-announce something to the subject's group (if linked) AND the channel.
// Best-effort and never throws — must not block the admin action that triggers it.
export async function announceToSubject(subjectId: string | null, text: string, link?: string): Promise<void> {
  try { if (subjectId) await postToSubjectGroup(subjectId, text, link); } catch { /* ignore */ }
  try { await sendTelegramChannel(text, link); } catch { /* ignore */ }
}

// Post to every linked subject group.
export async function postToAllGroups(text: string, link?: string): Promise<number> {
  const svc = createServiceClient();
  const { data } = await svc.from("subjects").select("telegram_group_chat_id").not("telegram_group_chat_id", "is", null);
  let n = 0;
  for (const s of data ?? []) {
    const chat = (s.telegram_group_chat_id as string) || "";
    if (chat && (await sendTelegramMessage(chat, text, link))) n++;
  }
  return n;
}
