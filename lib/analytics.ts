import { createServiceClient } from "@/lib/supabase/service";

// Site analytics from our OWN first-party data — page_views, class_watch and
// student_activity. No third-party tracker is involved, which is why these
// numbers can be shown to the founder at all.
//
// Everything is computed for a window AND for the window before it, because a
// visitor count on its own says nothing: 500 this week only means something
// next to last week's 400.

export type Range = 7 | 30 | 90;

export type Series = { label: string; value: number }[];

export type AnalyticsSnapshot = {
  days: Range;
  visitors: { now: number; before: number; series: Series };
  views: { now: number; before: number; series: Series };
  signups: { now: number; before: number };
  logins: { now: number; before: number };
  activeStudents: { now: number; before: number; series: Series };
  watchHours: { now: number; before: number; series: Series };
  topPages: { path: string; views: number }[];
  busiestDay: { label: string; value: number } | null;
  peakHourIST: { hour: number; views: number } | null;
};

const DAY = 86400_000;

function istDayKey(d: Date): string {
  // Days are counted in IST — a student studying at 11pm belongs to that day,
  // not to the next one in UTC.
  return new Date(d.getTime() + (5 * 60 + 30) * 60_000).toISOString().slice(0, 10);
}

function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/** Fill every day in the window, so a quiet day shows as a gap not a jump. */
function toSeries(counts: Map<string, number>, from: Date, days: number): Series {
  const out: Series = [];
  for (let i = 0; i < days; i++) {
    const key = istDayKey(new Date(from.getTime() + i * DAY));
    out.push({ label: shortLabel(key), value: counts.get(key) ?? 0 });
  }
  return out;
}

export async function loadAnalytics(days: Range): Promise<AnalyticsSnapshot> {
  const svc = createServiceClient();
  const now = Date.now();
  const start = new Date(now - days * DAY);
  const prevStart = new Date(now - 2 * days * DAY);

  // One read covers both windows; splitting it in SQL would be two round trips
  // for the same rows.
  const { data: views } = await svc
    .from("page_views")
    .select("path, event, user_id, visitor_key, created_at")
    .gte("created_at", prevStart.toISOString())
    .limit(200000);

  const rows = views ?? [];
  const inNow = (t: string) => new Date(t).getTime() >= start.getTime();

  const dayCounts = new Map<string, number>();
  const dayVisitors = new Map<string, Set<string>>();
  const dayStudents = new Map<string, Set<string>>();
  const hourCounts = new Map<number, number>();
  const pathCounts = new Map<string, number>();
  const seenNow = new Set<string>();
  const seenBefore = new Set<string>();
  const studentsNow = new Set<string>();
  const studentsBefore = new Set<string>();
  let viewsNow = 0;
  let viewsBefore = 0;
  let signupsNow = 0;
  let signupsBefore = 0;
  let loginsNow = 0;
  let loginsBefore = 0;

  for (const r of rows) {
    const t = String(r.created_at);
    const cur = inNow(t);
    const key = istDayKey(new Date(t));
    const visitor = String(r.visitor_key ?? "");
    const event = String(r.event ?? "view");

    if (event === "view") {
      if (cur) {
        viewsNow++;
        dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
        if (visitor) (dayVisitors.get(key) ?? dayVisitors.set(key, new Set()).get(key)!).add(visitor);
        if (r.user_id) (dayStudents.get(key) ?? dayStudents.set(key, new Set()).get(key)!).add(String(r.user_id));
        const h = new Date(new Date(t).getTime() + (5 * 60 + 30) * 60_000).getUTCHours();
        hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
        const p = String(r.path ?? "/").split("?")[0];
        pathCounts.set(p, (pathCounts.get(p) ?? 0) + 1);
      } else viewsBefore++;
    }
    if (event === "signup_success") cur ? signupsNow++ : signupsBefore++;
    if (event === "login_success") cur ? loginsNow++ : loginsBefore++;

    if (visitor) (cur ? seenNow : seenBefore).add(visitor);
    if (r.user_id) (cur ? studentsNow : studentsBefore).add(String(r.user_id));
  }

  // Watch time — the closest honest measure of how hard the site is being
  // used (and what the video bill follows).
  const { data: watch } = await svc
    .from("class_watch")
    .select("real_seconds, last_watched_at")
    .gte("last_watched_at", prevStart.toISOString())
    .limit(100000);
  let watchNow = 0;
  let watchBefore = 0;
  const watchByDay = new Map<string, number>();
  for (const w of watch ?? []) {
    const t = String(w.last_watched_at ?? "");
    if (!t) continue;
    const secs = Number(w.real_seconds) || 0;
    if (inNow(t)) {
      watchNow += secs;
      const key = istDayKey(new Date(t));
      watchByDay.set(key, (watchByDay.get(key) ?? 0) + secs);
    } else watchBefore += secs;
  }

  const visitorSeries = toSeries(
    new Map([...dayVisitors].map(([k, v]) => [k, v.size])),
    start,
    days,
  );
  const busiest = visitorSeries.reduce<{ label: string; value: number } | null>(
    (best, p) => (!best || p.value > best.value ? p : best),
    null,
  );
  const peak = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    days,
    visitors: { now: seenNow.size, before: seenBefore.size, series: visitorSeries },
    views: { now: viewsNow, before: viewsBefore, series: toSeries(dayCounts, start, days) },
    signups: { now: signupsNow, before: signupsBefore },
    logins: { now: loginsNow, before: loginsBefore },
    activeStudents: {
      now: studentsNow.size,
      before: studentsBefore.size,
      series: toSeries(new Map([...dayStudents].map(([k, v]) => [k, v.size])), start, days),
    },
    watchHours: {
      now: Math.round(watchNow / 3600),
      before: Math.round(watchBefore / 3600),
      series: toSeries(new Map([...watchByDay].map(([k, v]) => [k, Math.round(v / 3600)])), start, days),
    },
    topPages: [...pathCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([path, v]) => ({ path, views: v })),
    busiestDay: busiest && busiest.value > 0 ? busiest : null,
    peakHourIST: peak ? { hour: peak[0], views: peak[1] } : null,
  };
}
