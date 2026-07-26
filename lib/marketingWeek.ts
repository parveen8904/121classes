import { createServiceClient } from "@/lib/supabase/service";
import { generateSoftDay } from "@/lib/ai";
import { briefText, loadBrief } from "@/lib/marketingBrief";
import {
  angleFor, channelFlags, mentionFor, mentionsProduct, slotsForDay, weekSlots, type ChannelKey,
} from "@/lib/marketingRhythm";

// Writing one week of passive marketing: one idea a day, taught properly and
// rewritten in the voice of every channel that speaks that day (the rhythm
// lives in lib/marketingRhythm). Shared by the Monday cron, which schedules
// and emails the result, and by the admin Preview page, which only shows it.

const IST = (5 * 60 + 30) * 60 * 1000;

export type PlannedPost = {
  day: number;          // 0 = Monday
  focus: string;        // the day's idea, in a few words
  label: string;        // "Instagram", "LinkedIn", …
  channelKey: ChannelKey;
  at: number;           // UTC ms
  text: string;
};

export type PlannedWeek = {
  posts: PlannedPost[];             // in send order
  rows: Record<string, unknown>[];  // ready for scheduled_posts, same order
  error?: string;
};

// Every channel column, so a bulk insert has uniform keys on every row.
const NO_CHANNELS = {
  to_tg_channel: false, to_tg_groups: false, to_discord: false, to_direct: false, to_whatsapp: false,
  to_instagram: false, to_youtube: false, to_yt_video: false, to_twitter: false, to_linkedin: false,
  to_facebook: false, to_substack: false, to_medium: false, to_reddit: false, to_quora: false, to_google: false,
};

export async function planWeek(): Promise<PlannedWeek> {
  const svc = createServiceClient();

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

  // Where the students actually are this month — the founder keeps this up to
  // date on the Campaigns page, and nothing is written without reading it.
  const scenario = briefText(await loadBrief(svc));

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
    const results = await Promise.all(days.slice(i, i + 3).map(async (day) => {
      const channels = slotsForDay(week, day).map((c) => ({ key: c.key, label: c.label, brief: c.brief, maxChars: c.maxChars }));
      // The real calendar date, so a festival greeting lands on its own day.
      const dayLabel = new Date(istMidnightUtc + ((day - todayIdx + 7) % 7) * 86400e3 + 12 * 3600e3)
        .toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const out = await generateSoftDay({
        dayLabel,
        angle: angleFor(week, day),
        channels,
        context,
        scenario,
        avoid,
        mention: mentionsProduct(week, day) ? mentionFor(week, day) : null,
      });
      return [day, out] as const;
    }));
    for (const [day, out] of results) if (out) written.set(day, out);
  }
  if (!written.size) return { posts: [], rows: [], error: "AI unavailable — check the Anthropic key on Integrations and that the 'marketing' toggle is on in Admin → AI usage." };

  // Turn the written days into one post per channel slot.
  const posts: PlannedPost[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const slot of weekSlots(week)) {
    const day = written.get(slot.day);
    const text = day?.posts[slot.channel.key];
    if (!text) continue;
    // Where the week starts mid-cycle (autopilot switched on on a Thursday),
    // each channel simply gets its next occurrence.
    const offset = (slot.day - todayIdx + 7) % 7;
    const at = istMidnightUtc + offset * 86400e3 + (slot.channel.hour * 60 + slot.channel.minute) * 60e3;
    if (at < Date.now() + 15 * 60e3) continue; // that hour has already passed today
    posts.push({ day: slot.day, focus: day!.focus, label: slot.channel.label, channelKey: slot.channel.key, at, text });
  }
  posts.sort((a, b) => a.at - b.at);
  for (const p of posts) {
    rows.push({
      ...NO_CHANNELS,
      ...channelFlags(p.channelKey),
      body: p.text,
      campaign: `Autopilot · ${p.focus}`.slice(0, 120),
      send_at: new Date(p.at).toISOString(),
      ig_text: p.channelKey === "instagram" ? p.text : null,
      yt_text: p.channelKey === "youtube_community" ? p.text : null,
      x_text: p.channelKey === "twitter" ? p.text : null,
      created_by: "autopilot",
    });
  }
  return { posts, rows, error: posts.length ? undefined : "nothing to schedule" };
}
