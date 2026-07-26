import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendEmail, emailShell } from "@/lib/notify";
import { generateSoftDay } from "@/lib/ai";
import {
  DAY_NAMES, angleFor, cadenceLabel, channelFlags, mentionFor, mentionsProduct, slotsForDay, weekSlots,
  type ChannelKey,
} from "@/lib/marketingRhythm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Monday-morning marketing autopilot (opt-in via the Campaigns page toggle).
//
// It writes the coming week the way the founder wants it done: passively. One
// idea a day, taught properly, rewritten in each platform's own voice — and
// each platform speaks on its own rhythm (Telegram + Discord daily, Instagram
// and Facebook twice a week, a YouTube community post twice a week, one video
// a week, and so on — the whole table lives in lib/marketingRhythm). Roughly
// one day in three carries a single quiet line about something on the site;
// the rest ask for nothing at all.
//
// Everything lands as pending posts the founder can edit or delete, and he
// gets the full week by email on Monday morning. WhatsApp is never included
// (it costs per message and would be the one thing that reads as an ad).

const IST = (5 * 60 + 30) * 60 * 1000;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

// Every channel column, so a bulk insert has uniform keys on every row.
const NO_CHANNELS = {
  to_tg_channel: false, to_tg_groups: false, to_discord: false, to_direct: false, to_whatsapp: false,
  to_instagram: false, to_youtube: false, to_yt_video: false, to_twitter: false, to_linkedin: false,
  to_facebook: false, to_substack: false, to_medium: false, to_reddit: false, to_quora: false, to_google: false,
};

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // ?dry=1 writes the week and returns it without scheduling or emailing
  // anything — for reading the tone before trusting it with the accounts.
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  if (!dry) {
    // Opt-in switch (Campaigns page).
    const { data: flag } = await svc.from("site_settings").select("value").eq("key", "marketing_autopilot").maybeSingle();
    if (flag?.value !== "on") return NextResponse.json({ ok: true, skipped: "autopilot off" });

    // Don't double-schedule: skip if last week's autopilot posts haven't all gone.
    const { count: pendingAuto } = await svc
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("created_by", "autopilot")
      .eq("status", "pending");
    if ((pendingAuto ?? 0) > 0) return NextResponse.json({ ok: true, skipped: "autopilot posts already pending" });
  }

  // Real happenings the copy may mention — never anything invented.
  const { data: live } = await svc
    .from("live_sessions")
    .select("title, starts_at")
    .eq("is_published", true)
    .gte("starts_at", new Date().toISOString())
    .lte("starts_at", new Date(Date.now() + 10 * 86400e3).toISOString())
    .order("starts_at")
    .limit(5);
  const context = (live ?? []).length
    ? (live ?? []).map((s) => `- Live class "${s.title}" on ${new Date(s.starts_at as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST`).join("\n")
    : "- (nothing special this week — just teach)";

  // What the last few weeks already talked about, so the writer repeats nothing.
  const { data: past } = await svc
    .from("scheduled_posts")
    .select("campaign")
    .eq("created_by", "autopilot")
    .gte("send_at", new Date(Date.now() - 42 * 86400e3).toISOString())
    .not("campaign", "is", null)
    .limit(200);
  const avoid = [...new Set((past ?? []).map((p) => String(p.campaign).replace(/^Autopilot · /, "")))];

  // Midnight IST today, as a UTC instant — every slot hangs off this.
  const istNow = new Date(Date.now() + IST);
  const istMidnightUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - IST;
  const todayIdx = (istNow.getUTCDay() + 6) % 7; // 0 = Monday
  const week = Math.floor(istMidnightUtc / (7 * 86400e3));

  // Which days actually have channels speaking (the rhythm decides).
  const days = [...new Set(weekSlots(week).map((s) => s.day))].sort((a, b) => a - b);

  // One AI call per day — the whole day carries a single idea. Three at a time
  // keeps a slow API from eating the function's five minutes.
  const written = new Map<number, { focus: string; posts: Record<string, string> }>();
  for (let i = 0; i < days.length; i += 3) {
    const batch = days.slice(i, i + 3);
    const results = await Promise.all(batch.map(async (day) => {
      const channels = slotsForDay(week, day).map((c) => ({ key: c.key, label: c.label, brief: c.brief, maxChars: c.maxChars }));
      const out = await generateSoftDay({
        dayLabel: DAY_NAMES[day],
        angle: angleFor(week, day),
        channels,
        context,
        avoid,
        mention: mentionsProduct(week, day) ? mentionFor(week, day) : null,
      });
      return [day, out] as const;
    }));
    for (const [day, out] of results) if (out) written.set(day, out);
  }
  if (!written.size) return NextResponse.json({ ok: false, error: "AI unavailable or marketing toggle off" });

  // Turn the written days into one scheduled post per channel slot.
  const rows: Record<string, unknown>[] = [];
  const plan: { day: number; label: string; channel: string; at: number; text: string }[] = [];
  for (const slot of weekSlots(week)) {
    const day = written.get(slot.day);
    const text = day?.posts[slot.channel.key];
    if (!text) continue;
    // Where the week starts mid-cycle (autopilot switched on on a Thursday),
    // each channel simply gets its next occurrence.
    const offset = (slot.day - todayIdx + 7) % 7;
    const at = istMidnightUtc + offset * 86400e3 + (slot.channel.hour * 60 + slot.channel.minute) * 60e3;
    if (at < Date.now() + 15 * 60e3) continue; // that hour has already passed today
    rows.push({
      ...NO_CHANNELS,
      ...channelFlags(slot.channel.key as ChannelKey),
      body: text,
      campaign: `Autopilot · ${day!.focus}`.slice(0, 120),
      send_at: new Date(at).toISOString(),
      ig_text: slot.channel.key === "instagram" ? text : null,
      yt_text: slot.channel.key === "youtube_community" ? text : null,
      created_by: "autopilot",
    });
    plan.push({ day: slot.day, label: slot.channel.label, channel: slot.channel.key, at, text });
  }
  if (!rows.length) return NextResponse.json({ ok: false, error: "nothing to schedule" });
  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, count: rows.length,
      week: plan
        .sort((a, b) => a.at - b.at)
        .map((p) => ({
          day: DAY_NAMES[p.day],
          focus: written.get(p.day)?.focus,
          channel: p.label,
          at: new Date(p.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit" }),
          text: p.text,
        })),
    });
  }
  await svc.from("scheduled_posts").insert(rows);

  // The founder's one weekly email: the whole week, day by day, with a veto
  // window before anything goes out.
  const { data: admins } = await svc.from("profiles").select("email").eq("role", "admin").not("email", "is", null).limit(5);
  plan.sort((a, b) => a.at - b.at);
  let body = "";
  let lastDay = -1;
  for (const p of plan) {
    if (p.day !== lastDay) {
      lastDay = p.day;
      const focus = written.get(p.day)?.focus ?? "";
      body += `<p style="margin:20px 0 2px;font-size:15px"><strong>${DAY_NAMES[p.day]}</strong> — ${esc(focus)}</p>`;
    }
    const time = new Date(p.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
    body +=
      `<p style="margin:10px 0 3px;font-size:13px;color:#666">${esc(p.label)} · ${time} IST</p>` +
      `<div style="background:#f4f4f5;border-radius:8px;padding:10px;white-space:pre-wrap;font-size:14px">${esc(p.text)}</div>`;
  }
  const rhythm = weekSlots(week)
    .map((s) => s.channel)
    .filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i)
    .map((c) => `<li>${esc(c.label)} — ${esc(cadenceLabel(c))}</li>`)
    .join("");
  const html = emailShell("This week's posts are written",
    `<p><strong>${rows.length} posts</strong> are scheduled for the coming week. They are written to teach, not to sell — roughly one day in three carries a single quiet line about something on the site, and the rest ask for nothing.</p>
     <p style="font-size:13px;color:#666">This week's rhythm:</p><ul style="font-size:13px;color:#666;margin:0 0 6px">${rhythm}</ul>
     ${body}
     <p style="margin-top:18px"><a href="https://caparveensharma.com/admin/broadcasts">Read, edit or delete any of them →</a></p>`);
  for (const a of admins ?? []) await sendEmail(String(a.email), "This week's posts are ready — a quick look before they go", html).catch(() => false);

  return NextResponse.json({ ok: true, scheduled: rows.length, days: [...written.keys()] });
}
