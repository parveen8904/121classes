import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendEmail, emailShell } from "@/lib/notify";
import { planWeek } from "@/lib/marketingWeek";
import { CHANNELS, DAY_NAMES, cadenceLabel } from "@/lib/marketingRhythm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Monday-morning marketing autopilot (opt-in via the Campaigns page toggle).
//
// The week itself is written by lib/marketingWeek — one idea a day, taught
// properly and rewritten in each platform's own voice, each platform on its
// own rhythm (lib/marketingRhythm). This route only decides whether to run,
// saves the result as pending posts, and emails the founder the whole week so
// he can delete anything before it goes out. WhatsApp is never included.
//
// Reading the copy without scheduling anything: Admin → Campaigns → "Preview
// next week's posts" (the same planner, nothing saved).

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

  // Don't double-schedule: skip if last week's autopilot posts haven't all gone.
  const { count: pendingAuto } = await svc
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("created_by", "autopilot")
    .eq("status", "pending");
  if ((pendingAuto ?? 0) > 0) return NextResponse.json({ ok: true, skipped: "autopilot posts already pending" });

  const { posts, rows, error } = await planWeek();
  if (error || !rows.length) return NextResponse.json({ ok: false, error: error ?? "nothing to schedule" });
  await svc.from("scheduled_posts").insert(rows);

  // The founder's one weekly email: the whole week, day by day, with a veto
  // window before anything goes out.
  const { data: admins } = await svc.from("profiles").select("email").eq("role", "admin").not("email", "is", null).limit(5);
  let body = "";
  let lastDay = -1;
  for (const p of posts) {
    if (p.day !== lastDay) {
      lastDay = p.day;
      body += `<p style="margin:20px 0 2px;font-size:15px"><strong>${DAY_NAMES[p.day]}</strong> — ${esc(p.focus)}</p>`;
    }
    const time = new Date(p.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
    body +=
      `<p style="margin:10px 0 3px;font-size:13px;color:#666">${esc(p.label)} · ${time} IST</p>` +
      `<div style="background:#f4f4f5;border-radius:8px;padding:10px;white-space:pre-wrap;font-size:14px">${esc(p.text)}</div>`;
  }
  const used = new Set(posts.map((p) => p.channelKey));
  const rhythm = CHANNELS.filter((c) => used.has(c.key)).map((c) => `<li>${esc(c.label)} — ${esc(cadenceLabel(c))}</li>`).join("");
  const html = emailShell("This week's posts are written",
    `<p><strong>${rows.length} posts</strong> are scheduled for the coming week. They are written to teach, not to sell — roughly one day in three carries a single quiet line about something on the site, and the rest ask for nothing.</p>
     <p style="font-size:13px;color:#666">This week's rhythm:</p><ul style="font-size:13px;color:#666;margin:0 0 6px">${rhythm}</ul>
     ${body}
     <p style="margin-top:18px"><a href="https://caparveensharma.com/admin/broadcasts">Read, edit or delete any of them →</a></p>`);
  for (const a of admins ?? []) await sendEmail(String(a.email), "This week's posts are ready — a quick look before they go", html).catch(() => false);

  return NextResponse.json({ ok: true, scheduled: rows.length });
}
