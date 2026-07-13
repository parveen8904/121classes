import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { groupAiAnswer } from "@/lib/groupDoubt";
import { tgSendToGroup } from "@/lib/telegramGroup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by the always-on Discord worker when a student asks a question
// DIRECTLY in a Discord subject channel. Same brain as the Telegram groups
// (lib/groupDoubt: question check → admin toggle → daily cap → subject-grounded
// answer). Returns { answer } for the worker to post as a threaded Discord
// reply; also posts the same answer to the subject's Telegram group (where the
// worker already relayed the question) and stores it for the website view.
// Secured by the CRON_SECRET the worker already holds.
export async function POST(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { discordChannelId?: string; question?: string } = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  const question = (body.question ?? "").trim();
  const dcChannel = (body.discordChannelId ?? "").trim();
  if (!question || !dcChannel) return NextResponse.json({ answer: null });

  const svc = createServiceClient();
  const { data: subj } = await svc
    .from("subjects")
    .select("id, telegram_group_chat_id")
    .eq("discord_channel_id", dcChannel)
    .maybeSingle();
  if (!subj?.id) return NextResponse.json({ answer: null });

  const answer = await groupAiAnswer(subj.id, question);
  if (!answer) return NextResponse.json({ answer: null });

  // Follow the question into the Telegram group too (the worker already
  // relayed the question there), and store for the website discussion.
  const tg = (subj as { telegram_group_chat_id?: string | null }).telegram_group_chat_id;
  if (tg) {
    const sentId = await tgSendToGroup(tg, answer);
    if (sentId) {
      await svc.from("group_messages").upsert(
        {
          chat_id: tg,
          subject_id: subj.id,
          tg_message_id: sentId,
          source: "telegram",
          sender_tg_id: null,
          sender_name: "🤖 AI assistant",
          body: answer,
          flagged: false,
          flag_reasons: [],
          status: "visible",
        },
        { onConflict: "chat_id,tg_message_id" },
      );
    }
  }
  return NextResponse.json({ answer });
}
