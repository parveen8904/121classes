import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendEmail, emailShell } from "@/lib/notify";
import { generateCampaignPack } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Monday-morning marketing autopilot (opt-in via the Campaigns page toggle).
// Writes the coming week's posts with AI, schedules them daily at 7 pm IST
// starting tomorrow, and emails the admins the full plan — so the founder's
// only job is to delete/edit anything he doesn't like before evening.
// Channels: Telegram channel auto-posts; Instagram & YouTube variants arrive
// by reminder email at each post's send time. WhatsApp is never auto-included
// (it costs per message) — add it manually to any post-worthy campaign.

const THEMES = [
  "The FREE day-by-day study planner — get students to build their plan",
  "FREE chapter MCQ tests with rank & concept report",
  "Case-study (case-scenario) practice for the new exam pattern",
  "Exam mindset & consistency — study tips that end at the free tools",
];

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // Opt-in switch (Campaigns page).
  const { data: flag } = await svc.from("site_settings").select("value").eq("key", "marketing_autopilot").maybeSingle();
  if (flag?.value !== "on") return NextResponse.json({ ok: true, skipped: "autopilot off" });

  // Don't double-schedule: skip if this week's autopilot posts already exist.
  const { count: pendingAuto } = await svc
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("created_by", "autopilot")
    .eq("status", "pending");
  if ((pendingAuto ?? 0) > 0) return NextResponse.json({ ok: true, skipped: "autopilot posts already pending" });

  // Real happenings the copy may mention.
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
    : "- (no special events — promote the evergreen free tools)";

  // Rotate the weekly theme so campaigns don't repeat themselves.
  const week = Math.floor(Date.now() / (7 * 86400e3));
  const theme = THEMES[week % THEMES.length];

  const days = 6; // Tue–Sun; Monday is planning day
  const posts = await generateCampaignPack(theme, days, context);
  if (!posts?.length) return NextResponse.json({ ok: false, error: "AI unavailable or marketing toggle off" });

  // Daily at 19:00 IST (13:30 UTC), starting tomorrow.
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + 1);
  base.setUTCHours(13, 30, 0, 0);

  const rows = posts.map((p) => ({
    body: p.message,
    campaign: `Autopilot: ${theme.slice(0, 60)}`,
    send_at: new Date(base.getTime() + p.day * 86400e3).toISOString(),
    to_tg_channel: true,
    to_tg_groups: false,
    to_discord: false,
    to_direct: false,
    to_whatsapp: false,
    to_instagram: true,
    to_youtube: true,
    ig_text: p.instagram || null,
    yt_text: p.youtube || null,
    created_by: "autopilot",
  }));
  await svc.from("scheduled_posts").insert(rows);

  // The founder's one weekly email: this week's plan, with a veto window.
  const { data: admins } = await svc.from("profiles").select("email").eq("role", "admin").not("email", "is", null).limit(5);
  const list = posts.map((p, i) =>
    `<p style="margin:14px 0 4px"><strong>Day ${i + 1} — ${esc(p.focus)}</strong> (${new Date(rows[i].send_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}, 7 pm)</p>
     <div style="background:#f4f4f5;border-radius:8px;padding:10px;white-space:pre-wrap;font-size:14px">${esc(p.message)}</div>`).join("");
  const html = emailShell("📣 This week's marketing is scheduled",
    `<p>Autopilot has written and scheduled <strong>${rows.length} posts</strong> for this week (theme: ${esc(theme)}). The first goes out <strong>tomorrow 7 pm IST</strong> on the Telegram channel; Instagram &amp; YouTube versions will reach you by email at each post time.</p>
     ${list}
     <p><a href="https://caparveensharma.com/admin/broadcasts">Review, edit or delete any of them →</a></p>`);
  for (const a of admins ?? []) await sendEmail(String(a.email), "📣 This week's posts are scheduled — review them", html).catch(() => false);

  return NextResponse.json({ ok: true, scheduled: rows.length, theme });
}
