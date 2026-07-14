import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendTelegramMessage } from "@/lib/notify";
import { tgSendToGroup } from "@/lib/telegramGroup";
import { discordSendToChannel } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every 10 minutes: post any due scheduled marketing messages to their chosen
// targets — the Telegram channel, every subject Telegram group, and/or every
// subject Discord channel. Light query when nothing is due; NOT off-peak gated
// (marketing posts go out at daytime hours by design).
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data: due } = await svc
    .from("scheduled_posts")
    .select("id, body, link_url, to_tg_channel, to_tg_groups, to_discord")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at")
    .limit(10);
  if (!due?.length) return NextResponse.json({ ok: true, sent: 0 });

  // Targets are shared across posts — fetch once.
  const [channel, { data: subjects }] = await Promise.all([
    getSecret("TELEGRAM_CHANNEL_ID"),
    svc.from("subjects").select("telegram_group_chat_id, discord_channel_id"),
  ]);
  const tgGroups = [...new Set((subjects ?? []).map((s) => s.telegram_group_chat_id as string | null).filter(Boolean))] as string[];
  const dcChannels = [...new Set((subjects ?? []).map((s) => s.discord_channel_id as string | null).filter(Boolean))] as string[];

  let sent = 0;
  for (const p of due) {
    const text = p.link_url ? `${p.body}\n\n${p.link_url}` : p.body;
    const notes: string[] = [];
    try {
      if (p.to_tg_channel) {
        if (channel) { if (!(await sendTelegramMessage(channel, text))) notes.push("channel failed"); }
        else notes.push("no channel configured");
      }
      if (p.to_tg_groups) {
        if (!tgGroups.length) notes.push("no groups linked");
        for (const g of tgGroups) { if (!(await tgSendToGroup(g, text))) notes.push(`group ${g} failed`); }
      }
      if (p.to_discord) {
        if (!dcChannels.length) notes.push("no discord channels linked");
        for (const c of dcChannels) { if (!(await discordSendToChannel(c, text))) notes.push(`discord ${c} failed`); }
      }
      await svc.from("scheduled_posts").update({
        status: notes.length && notes.length >= [p.to_tg_channel, p.to_tg_groups, p.to_discord].filter(Boolean).length ? "failed" : "sent",
        status_note: notes.length ? notes.join("; ").slice(0, 300) : null,
        sent_at: new Date().toISOString(),
      }).eq("id", p.id);
      sent++;
    } catch (e) {
      await svc.from("scheduled_posts").update({ status: "failed", status_note: e instanceof Error ? e.message : "error" }).eq("id", p.id);
    }
  }
  return NextResponse.json({ ok: true, sent });
}
