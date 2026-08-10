// "Today" for students is INDIAN today. The server runs in UTC, which is 5½
// hours behind IST — so between midnight and 05:30 IST a naive new Date()
// still reports yesterday (students log in from ~5 AM and saw yesterday's
// study target). Always derive the student-facing date in Asia/Kolkata.

export function todayIST(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function todayISTParts(): { y: number; m: number; d: number } {
  const [y, m, d] = todayIST().split("-").map(Number);
  return { y, m, d };
}

// ── ONE DATE FORMAT FOR THE WHOLE SITE: 25 August 2026 ─────────────────────
//
// There were a dozen. "9 Aug 2026" on one screen, "Aug 9, 2026" on another,
// "09/08/2026" on a third, and a bare "9 Aug" where the year mattered. A
// student reading "05/08" cannot tell the fifth of August from the eighth of
// May, and neither can an accountant reading an invoice.
//
// Day, month written out, year. Longer than "9 Aug 26", never ambiguous — and
// on an exam date or a subscription expiry that is worth the four characters.
//
// Always rendered in IST, wherever the reader is. A date that quietly shifts by
// a day across a timezone boundary is the worst bug of this kind, because it
// looks correct to whoever tested it.

const IST = "Asia/Kolkata";
type When = string | number | Date | null | undefined;

function asDate(v: When): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 25 August 2026 */
export function formatDate(v: When, fallback = "\u2014"): string {
  const d = asDate(v);
  if (!d) return fallback;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: IST });
}

/** 3:30 pm */
export function formatTime(v: When, fallback = "\u2014"): string {
  const d = asDate(v);
  if (!d) return fallback;
  return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST }).toLowerCase();
}

/** 25 August 2026, 3:30 pm */
export function formatDateTime(v: When, fallback = "\u2014"): string {
  const d = asDate(v);
  if (!d) return fallback;
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** Monday, 25 August 2026 — for a study plan, where the weekday is the point. */
export function formatDateWithDay(v: When, fallback = "\u2014"): string {
  const d = asDate(v);
  if (!d) return fallback;
  return `${d.toLocaleDateString("en-GB", { weekday: "long", timeZone: IST })}, ${formatDate(d)}`;
}

/** August 2026 — a month heading, where a day would be wrong. */
export function formatMonth(v: When, fallback = "\u2014"): string {
  const d = asDate(v);
  if (!d) return fallback;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: IST });
}

/**
 * Mon / Tue — a weekday label, not a date.
 *
 * Deliberately NOT converted to IST. The planner builds its days by arithmetic
 * on a start date and asks getDay() for Sundays; forcing a timezone here would
 * make this label disagree with that check on the very days it matters.
 */
export function weekdayShort(v: When, fallback = ""): string {
  const d = asDate(v);
  if (!d) return fallback;
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}
