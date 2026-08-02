import { createServiceClient } from "@/lib/supabase/service";

// Site analytics from our OWN first-party data — page_views, class_watch and
// student_activity. No third-party tracker is involved, which is why these
// numbers can be shown to the founder at all.
//
// The counting happens IN Postgres (admin_analytics_* functions, 0092). An
// earlier version pulled every row in the window into Node and counted there,
// which meant a near-full table read on every page load — the fastest way to
// drain the project's Disk IO budget. Now the database returns ~90 rows.
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

type DailyRow = { d: string; visitors: number; views: number; students: number; signups: number; logins: number };
type WatchRow = { d: string; seconds: number };

function istToday(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60_000).toISOString().slice(0, 10);
}

function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/** Fill every day in the window so a quiet day reads as a gap, not a jump. */
function fill(byDay: Map<string, number>, days: number): Series {
  const out: Series = [];
  const today = new Date(`${istToday()}T00:00:00Z`).getTime();
  for (let i = days - 1; i >= 0; i--) {
    const iso = new Date(today - i * DAY).toISOString().slice(0, 10);
    out.push({ label: shortLabel(iso), value: byDay.get(iso) ?? 0 });
  }
  return out;
}

/** Split the returned days into "this window" and "the one before". */
function split<T extends { d: string }>(rows: T[], days: number): { now: T[]; before: T[] } {
  const cutoff = new Date(new Date(`${istToday()}T00:00:00Z`).getTime() - (days - 1) * DAY)
    .toISOString()
    .slice(0, 10);
  return {
    now: rows.filter((r) => r.d >= cutoff),
    before: rows.filter((r) => r.d < cutoff),
  };
}

const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0);

export async function loadAnalytics(days: Range): Promise<AnalyticsSnapshot> {
  const svc = createServiceClient();

  const [daily, watch, top, peak] = await Promise.all([
    svc.rpc("admin_analytics_daily", { days }),
    svc.rpc("admin_analytics_watch", { days }),
    svc.rpc("admin_analytics_top_pages", { days, lim: 12 }),
    svc.rpc("admin_analytics_peak_hour", { days }),
  ]);

  const rows = ((daily.data ?? []) as DailyRow[]).map((r) => ({ ...r, d: String(r.d).slice(0, 10) }));
  const watchRows = ((watch.data ?? []) as WatchRow[]).map((r) => ({ ...r, d: String(r.d).slice(0, 10) }));

  const d = split(rows, days);
  const w = split(watchRows, days);

  const seriesOf = (list: DailyRow[], pick: (r: DailyRow) => number) =>
    fill(new Map(list.map((r) => [r.d, Number(pick(r)) || 0])), days);

  const visitorSeries = seriesOf(d.now, (r) => r.visitors);
  const busiest = visitorSeries.reduce<{ label: string; value: number } | null>(
    (best, p) => (!best || p.value > best.value ? p : best),
    null,
  );

  const peakRow = ((peak.data ?? []) as { hour: number; views: number }[])[0];

  return {
    days,
    // Distinct-per-day summed across days over-counts a person who returns on
    // several days; it is the honest number the database can give cheaply, and
    // both windows are counted the same way so the comparison stays fair.
    visitors: { now: sum(d.now, (r) => r.visitors), before: sum(d.before, (r) => r.visitors), series: visitorSeries },
    views: { now: sum(d.now, (r) => r.views), before: sum(d.before, (r) => r.views), series: seriesOf(d.now, (r) => r.views) },
    signups: { now: sum(d.now, (r) => r.signups), before: sum(d.before, (r) => r.signups) },
    logins: { now: sum(d.now, (r) => r.logins), before: sum(d.before, (r) => r.logins) },
    activeStudents: {
      now: sum(d.now, (r) => r.students),
      before: sum(d.before, (r) => r.students),
      series: seriesOf(d.now, (r) => r.students),
    },
    watchHours: {
      now: Math.round(sum(w.now, (r) => r.seconds) / 3600),
      before: Math.round(sum(w.before, (r) => r.seconds) / 3600),
      series: fill(new Map(w.now.map((r) => [r.d, Math.round((Number(r.seconds) || 0) / 3600)])), days),
    },
    topPages: ((top.data ?? []) as { path: string; views: number }[]).map((p) => ({
      path: p.path,
      views: Number(p.views) || 0,
    })),
    busiestDay: busiest && busiest.value > 0 ? busiest : null,
    peakHourIST: peakRow ? { hour: Number(peakRow.hour), views: Number(peakRow.views) } : null,
  };
}
