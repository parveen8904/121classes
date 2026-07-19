// Summarise a live-class schedule for display: dates, weekdays and start time
// are DERIVED from the actual class_schedule rows, never hard-coded — so when
// the admin shifts a class, takes a day off or adds an extra session, every
// banner and card updates by itself.

export type ScheduleSummary = {
  from: string;      // "3 Aug 2026"
  to: string;        // "18 Sep 2026"
  sessions: number;
  daysLabel: string; // "Mon · Wed · Fri" (IST weekdays actually scheduled)
  timeLabel: string; // "6:30 am" (the most common IST start time)
};

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function summarizeSchedule(rows: { scheduled_at: string }[]): ScheduleSummary | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const daySet = new Set<number>();
  const timeCount = new Map<string, number>();
  for (const r of sorted) {
    const d = new Date(r.scheduled_at);
    daySet.add(new Date(d.getTime() + 5.5 * 3600 * 1000).getUTCDay()); // IST weekday
    const t = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
    timeCount.set(t, (timeCount.get(t) ?? 0) + 1);
  }
  const daysLabel = [1, 2, 3, 4, 5, 6, 0].filter((d) => daySet.has(d)).map((d) => WEEK[d]).join(" · ");
  const timeLabel = [...timeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return { from: fmtDate(sorted[0].scheduled_at), to: fmtDate(sorted[sorted.length - 1].scheduled_at), sessions: sorted.length, daysLabel, timeLabel };
}
