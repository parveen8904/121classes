import { formatDateWithDay } from "@/lib/dates";
// Indian festival dates, from the source Google itself uses.
//
// The founder's ask was "all Indian holidays", and most of them move every
// year — Raksha Bandhan, Janmashtami, Ganesh Chaturthi, Diwali. Typing them
// by hand means a wrong greeting on the wrong day sooner or later, so we read
// the public "Holidays in India" calendar instead. It needs no key, no login
// and no yearly maintenance: the dates are simply always right.
//
// Anything marked "(tentative)" is skipped — a greeting on the wrong day is
// worse than no greeting.

const ICS_URL =
  "https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// The calendar carries every observance in the country, including solemn ones
// and the small in-between days of a longer festival. Wishing someone a happy
// martyrdom day, or sending four greetings in one Durga Puja week, is worse
// than staying quiet — so only the days people actually greet each other on
// become greetings. Everything else is simply ignored.
const SOLEMN = /martyrdom|death anniversary|remembrance|shaheed|balidan|memorial|\beve\b/i;
const GREETED =
  /diwali|deepavali|holi|raksha bandhan|rakhi|janmashtami|ganesh chaturthi|dussehra|vijayadashami|navratri|durga puja|eid|bakrid|christmas|guru nanak|guru purnima|baisakhi|vaisakhi|pongal|makar sankranti|lohri|onam|ugadi|gudi padwa|bihu|independence day|republic day|gandhi jayanti|new year|mahavir jayanti|buddha purnima|good friday|easter|bhai duj|chhat|karva chauth|rama? navami|shivaratri|navroz|milad|teachers.? day|vasant panchami|basant panchami|saraswati puja/i;

// The one Janmashtami/Diwali entry per day is enough — the calendar sometimes
// lists regional variants of the same festival on the same date.
const isGreetable = (name: string) => !SOLEMN.test(name) && GREETED.test(name);

// The big ones. On these days every channel carries the greeting and nothing
// else — the founder's call, and the right one: on Guru Purnima a teacher who
// posts a revision tip instead of a word to his students looks like a machine.
// The smaller days keep the lighter treatment (Telegram and Instagram only).
const MAJOR =
  /guru purnima|guru poornima|diwali|deepavali|holi|raksha bandhan|rakhi|janmashtami|ganesh chaturthi|dussehra|vijayadashami|navratri|eid|christmas|guru nanak|independence day|republic day|gandhi jayanti|pongal|makar sankranti|onam|baisakhi|vaisakhi|new year/i;

export const isMajorFestival = (names: string[]) => names.some((n) => MAJOR.test(n));

// Festivals the public calendars do not carry at all.
//
// Guru Purnima is the teacher's day of the Indian year — for a teaching
// brand it is the most important date on this list — and Google's "Holidays
// in India" AND "Hindu Holidays" calendars both omit it completely. It moves
// with the lunar calendar, so there is nothing to compute; the dates are
// listed here one at a time, each one verified, and when the list runs out
// the Campaigns page says so rather than skipping the day in silence.
const SUPPLEMENT: Record<string, string> = {
  "2026-07-29": "Guru Purnima", // Ashadha Purnima / Vyasa Purnima
  "2027-07-18": "Guru Purnima",
};

// The last date the supplement covers — shown to the founder so the list is
// topped up before it lapses, never discovered empty.
export const SUPPLEMENT_UNTIL = Object.keys(SUPPLEMENT).sort().slice(-1)[0];

export type CalendarEvent = { date: string; name: string; source: "calendar" | "builtin" };

// Everything the calendar carries, unfiltered — the founder's list to choose
// from. Our own supplement (Guru Purnima and anything else Google omits) is
// merged in and marked as such.
export async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = Object.entries(SUPPLEMENT).map(([date, name]) => ({ date, name, source: "builtin" as const }));
  const seen = new Set(out.map((e) => `${e.date}|${e.name.toLowerCase()}`));
  try {
    const res = await fetch(ICS_URL, { next: { revalidate: 43200 } });
    if (!res.ok) return out;
    // ICS folds long lines with a leading space — unfold before parsing.
    const text = (await res.text()).replace(/\r?\n[ \t]/g, "");
    for (const block of text.split("BEGIN:VEVENT").slice(1)) {
      const date = block.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
      const summary = block.match(/\nSUMMARY:(.*)/);
      if (!date || !summary) continue;
      const name = summary[1].trim().replace(/\\,/g, ",");
      if (!name) continue;
      const key = `${date[1]}-${date[2]}-${date[3]}|${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ date: `${date[1]}-${date[2]}-${date[3]}`, name, source: "calendar" });
    }
  } catch {
    // Never let a calendar outage stop the week from being written.
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Sensible starting points when a date is first imported — he can change both.
export const defaultGreet = (name: string) => !/tentative/i.test(name) && isGreetable(name);
export const defaultAllChannels = (name: string) => isMajorFestival([name]);

// date ("2026-08-28") → the festivals falling on it. Used only as a fallback
// before the founder's own list exists (lib/marketingWeek prefers the table).
export async function festivalCalendar(): Promise<Map<string, string[]>> {
  const byDate = new Map<string, string[]>();
  for (const e of await fetchCalendarEvents()) {
    const name = e.name.replace(/\s*\([^)]*\)\s*$/, "");
    if (e.source === "calendar" && !defaultGreet(e.name)) continue;
    const already = byDate.get(e.date) ?? [];
    // Regional variants of one festival on one date collapse into one name.
    if (already.some((n) => n.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(n.toLowerCase()))) continue;
    byDate.set(e.date, [...already, name]);
  }
  return byDate;
}

// The festivals falling in the next `days` days, oldest first, as
// "28 August 2026 (Friday) — Raksha Bandhan".
export function festivalsAhead(cal: Map<string, string[]>, from: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86400e3);
    const names = cal.get(ymd(d));
    if (!names?.length) continue;
    const label = formatDateWithDay(d);
    out.push(`${label} — ${names.join(", ")}`);
  }
  return out;
}

// The festivals on one specific day, if any.
export const festivalsOn = (cal: Map<string, string[]>, day: Date): string[] => cal.get(ymd(day)) ?? [];

// ---- The founder's own list (festival_days) ---------------------------------
// The calendar is the raw source; this table is what actually goes out. He
// picks which days are worth a greeting, which are big enough to take over
// every channel, renames anything awkward, and adds what no calendar knows.

export type FestivalDay = {
  id: string; on_date: string; name: string;
  greet: boolean; all_channels: boolean; source: string;
};

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function loadFestivalDays(svc: Db, fromDate: string, toDate: string): Promise<FestivalDay[]> {
  const { data } = await svc
    .from("festival_days")
    .select("id, on_date, name, greet, all_channels, source")
    .gte("on_date", fromDate)
    .lte("on_date", toDate)
    .order("on_date");
  return (data ?? []) as FestivalDay[];
}

// Pull the calendar in without ever overriding a choice he has already made:
// dates already in the table are left exactly as they are.
export async function importCalendarInto(svc: Db, months = 15): Promise<{ added: number; total: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + months * 30 * 86400e3).toISOString().slice(0, 10);
  const events = (await fetchCalendarEvents()).filter((e) => e.date >= today && e.date <= until);
  if (!events.length) return { added: 0, total: 0 };
  const current = await loadFestivalDays(svc, today, until);
  const existing = new Set(current.map((r) => `${r.on_date}|${r.name.toLowerCase()}`));
  // One festival per date, not three spellings of it: the calendar lists
  // regional variants ("Janmashtami", "Janmashtami (Smarta)") separately, and
  // a list with both in it is a list nobody wants to read. Shortest name wins.
  const bare = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().trim();
  const kept = new Map<string, string>(); // date → bare name already taken
  for (const r of current) kept.set(`${r.on_date}|${bare(r.name)}`, bare(r.name));
  const rows: { on_date: string; name: string; greet: boolean; all_channels: boolean; source: string }[] = [];
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date) || a.name.length - b.name.length)) {
    if (existing.has(`${e.date}|${e.name.toLowerCase()}`)) continue;
    const b = bare(e.name);
    const variantOfSameDay = [...kept.entries()].some(([k, v]) =>
      k.startsWith(`${e.date}|`) && (v.includes(b) || b.includes(v)));
    if (variantOfSameDay) continue;
    kept.set(`${e.date}|${b}`, b);
    const greet = e.source === "builtin" ? true : defaultGreet(e.name);
    rows.push({
      on_date: e.date,
      name: e.name,
      greet,
      // A day we do not greet on cannot be a day that takes over every
      // channel — that combination only ever looks like a mistake.
      all_channels: greet && defaultAllChannels(e.name),
      source: e.source,
    });
  }
  if (rows.length) await svc.from("festival_days").upsert(rows, { onConflict: "on_date,name", ignoreDuplicates: true });
  return { added: rows.length, total: events.length };
}

// The founder's own dates, typed as "29 July — Guru Purnima", "29 Jul: X",
// "29/07/2026 X". Anything the calendars miss, he can add in one line — so
// this parser forgives however he writes the date.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function manualFestivalsOn(lines: string[], day: Date): string[] {
  const d = day.getUTCDate();
  const m = day.getUTCMonth();
  const y = day.getUTCFullYear();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d{1,2})\s*[-/. ]\s*([A-Za-z]{3,}|\d{1,2})(?:\s*[-/. ]\s*(\d{4}))?\s*[—–:-]?\s*(.*)$/);
    if (!match) continue;
    const [, dayStr, monthStr, yearStr, name] = match;
    const month = /^\d+$/.test(monthStr) ? Number(monthStr) - 1 : MONTHS.indexOf(monthStr.slice(0, 3).toLowerCase());
    if (month < 0 || Number(dayStr) !== d || month !== m) continue;
    if (yearStr && Number(yearStr) !== y) continue;
    if (name.trim()) out.push(name.trim());
  }
  return out;
}
