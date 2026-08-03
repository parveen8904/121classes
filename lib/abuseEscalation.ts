import { createServiceClient } from "@/lib/supabase/service";
import { tgRestrictUser } from "@/lib/telegramGroup";
import { ABUSE_WARNING } from "@/lib/ai";

// Warned once, removed the second time.
//
// The bot tells an abusive student plainly that repeating it will cost them
// their place in the group. Leaving the removal to somebody noticing later
// makes that a bluff, so the second offence carries it out.

export const ABUSE_REMOVED =
  "You were already warned about this. Your access to this study group has now been withdrawn.\n\n" +
  "If you believe this is a mistake, write to contact@caparveensharma.com.\n\n" +
  "— CA Parveen Sharma Classes";

/**
 * Record an abusive message and decide what happens.
 * Returns the message to post back, and whether the student was removed.
 */
export async function handleAbuse(input: {
  chatId: string;
  tgUserId: string | null;
  text: string;
  studentUserId?: string | null;
  senderName?: string | null;
}): Promise<{ reply: string; removed: boolean }> {
  const svc = createServiceClient();
  // With no Telegram id there is nobody to remove — warn and leave it.
  if (!input.tgUserId) return { reply: ABUSE_WARNING, removed: false };

  const { data: prior } = await svc
    .from("abuse_warnings")
    .select("warnings")
    .eq("chat_id", input.chatId)
    .eq("tg_user_id", input.tgUserId)
    .maybeSingle();

  const count = Number(prior?.warnings ?? 0) + 1;
  const removing = count >= 2;

  await svc.from("abuse_warnings").upsert(
    {
      chat_id: input.chatId,
      tg_user_id: input.tgUserId,
      warnings: count,
      last_at: new Date().toISOString(),
      last_text: input.text.slice(0, 400),
      removed_at: removing ? new Date().toISOString() : null,
    },
    { onConflict: "chat_id,tg_user_id" },
  );

  if (!removing) return { reply: ABUSE_WARNING, removed: false };

  // Second offence — remove from the group, and record it where the team can
  // see and undo it (Admin → Group moderation).
  await tgRestrictUser(input.chatId, input.tgUserId, true).catch(() => false);
  try {
    await svc.from("banned_group_users").upsert(
      {
        chat_id: input.chatId,
        user_id: input.studentUserId ?? null,
        tg_user_id: input.tgUserId,
        kind: "ban",
        reason: `Removed automatically: abusive language after a warning${input.senderName ? ` (${input.senderName})` : ""}`,
        banned_by: null,
      },
      { onConflict: "chat_id,tg_user_id" },
    );
  } catch {
    /* the removal already happened on Telegram; the record is best-effort */
  }

  return { reply: ABUSE_REMOVED, removed: true };
}
