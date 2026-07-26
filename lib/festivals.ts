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
  /diwali|deepavali|holi|raksha bandhan|rakhi|janmashtami|ganesh chaturthi|dussehra|vijayadashami|navratri|durga puja|eid|bakrid|christmas|guru nanak|baisakhi|vaisakhi|pongal|makar sankranti|lohri|onam|ugadi|gudi padwa|bihu|independence day|republic day|gandhi jayanti|new year|mahavir jayanti|buddha purnima|good friday|easter|bhai duj|chhat|karva chauth|ram navami|shivaratri|navroz|milad|teachers.? day/i;

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

// date ("2026-08-28") → the festivals falling on it.
export async function festivalCalendar(): Promise<Map<string, string[]>> {
  const byDate = new Map<string, string[]>();
  for (const [date, name] of Object.entries(SUPPLEMENT)) byDate.set(date, [name]);
  try {
    const res = await fetch(ICS_URL, { next: { revalidate: 43200 } });
    if (!res.ok) return byDate;
    // ICS folds long lines with a leading space — unfold before parsing.
    const text = (await res.text()).replace(/\r?\n[ \t]/g, "");
    for (const block of text.split("BEGIN:VEVENT").slice(1)) {
      const date = block.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
      const summary = block.match(/\nSUMMARY:(.*)/);
      if (!date || !summary) continue;
      const name = summary[1].trim().replace(/\\,/g, ",").replace(/\s*\([^)]*\)\s*$/, "");
      if (!name || /tentative/i.test(summary[1]) || !isGreetable(name)) continue;
      const key = `${date[1]}-${date[2]}-${date[3]}`;
      const already = byDate.get(key) ?? [];
      // Regional variants of one festival on one date collapse into one name.
      if (already.some((n) => n.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(n.toLowerCase()))) continue;
      byDate.set(key, [...already, name]);
    }
  } catch {
    // Never let a calendar outage stop the week from being written.
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
    const label = d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", weekday: "long" });
    out.push(`${label} — ${names.join(", ")}`);
  }
  return out;
}

// The festivals on one specific day, if any.
export const festivalsOn = (cal: Map<string, string[]>, day: Date): string[] => cal.get(ymd(day)) ?? [];

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
