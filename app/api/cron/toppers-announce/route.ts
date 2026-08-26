import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { istDay, toppersMessage, toppersPushBody, toppersPushTitle, type Track } from "@/lib/dailyToppers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 3 AM IST — TELL EVERYONE WHO TOPPED.
//
// Reads the answer frozen at 11:59 PM and sends it to the phones, the Telegram
// groups and Discord. It decides nothing itself.
//
// WHICH DAY. Firing at 03:00 IST means the day that just ended is yesterday by
// this job's clock, so it steps back. An hour is not enough here (unlike the
// warehouse job at 00:30) — three hours have passed — so the previous IST
// calendar day is taken directly.
//
// WHAT GOES OUT: names, and nothing else. No marks, no percentage, no paper, no
// phone number, no email. This lands in group chats where every student can
// read it, and a topper is being congratulated, not ranked in public.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const asked = params.get("day");
  const yesterday = istDay(new Date(Date.now() - 24 * 3600e3));
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : yesterday;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("daily_toppers")
    .select("day, track, student_name, announced_at")
    .eq("day", day);
  if (error) {
    return NextResponse.json({ ok: false, day, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as { track: Track; student_name: string; announced_at: string | null }[];
  if (!rows.length) {
    // A quiet day is not a fault: nothing was released, so nobody topped.
    return NextResponse.json({ ok: true, day, sent: false, note: "no toppers recorded for that day" });
  }
  // ANNOUNCED ONCE. A retry, a manual run or a double-fire must not put the
  // same congratulations in the group twice.
  if (rows.every((r) => r.announced_at) && params.get("again") !== "1") {
    return NextResponse.json({ ok: true, day, sent: false, note: "already announced" });
  }

  const text = toppersMessage(rows, day);
  const link = "https://caparveensharma.com/learn/performance";

  // ONE MESSAGE, EVERYWHERE — not one per subject.
  //
  // His instruction: the channel AND both groups, "irrespective of inter
  // Final". A Final topper is news in the Intermediate room too; splitting the
  // announcement by subject would have shown each group only half of it.
  const [channel, tg, dc, push] = await Promise.all([
    // The Telegram channel — the broadcast one students follow.
    import("@/lib/notify").then((m) => m.sendTelegramChannel(text, link)).catch(() => false),
    // Every subject group, the same full message in each.
    import("@/lib/telegramBroadcast").then((m) => m.postToAllGroups(text, link)).catch(() => 0),
    // Discord.
    import("@/lib/discord").then((m) => m.postToDiscord(text, link)).catch(() => false),
    // Phones — Android and iPhone both, through the one helper.
    import("@/lib/push").then((m) => m.pushToEveryone({
      title: toppersPushTitle(day),
      body: toppersPushBody(rows),
      link: "/learn/performance",
    })).catch(() => null),
  ]);

  await svc.from("daily_toppers").update({ announced_at: new Date().toISOString() }).eq("day", day);

  return NextResponse.json({
    ok: true, day, sent: true,
    telegramChannel: channel, telegramGroups: tg, discord: dc,
    push: push ? { sent: push.sent, failed: push.failed } : null,
    toppers: rows.map((r) => ({ track: r.track, name: r.student_name })),
  });
}
