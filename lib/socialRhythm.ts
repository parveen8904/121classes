// THE WEEK, AS THE FOUNDER DESCRIBED IT.
//
// Long-form on Wednesday and Friday. Something on Instagram and Facebook every
// other day. One line on X every day. A video three times a week. And a voice
// meeting for Nova Seed on a Saturday evening, once a fortnight.
//
// It is written down here, once, because a posting rhythm that lives in
// somebody's head is a rhythm that stops the first busy week. What this file
// produces is a RECOMMENDATION for a week — the founder amends it, drops what
// he does not want, and only then does anything get scheduled.
//
// A note on "every 15th day, Saturday evening": fifteen days is not a multiple
// of seven, so a strict fifteen-day cycle walks off Saturday within one turn
// (Sat → Sun → Mon …). Saturday is the part that matters for a voice meeting —
// people are free — so this is every SECOND Saturday, fourteen days apart. It
// is the nearest thing to what was asked that stays on a Saturday, and it is
// said out loud on the page rather than quietly decided here.

export type Channel =
  | "linkedin" | "medium" | "substack"
  | "instagram" | "facebook"
  | "x" | "youtube" | "discord";

export const CHANNEL_LABEL: Record<Channel, string> = {
  linkedin: "LinkedIn", medium: "Medium", substack: "Substack",
  instagram: "Instagram", facebook: "Facebook",
  x: "X (Twitter)", youtube: "YouTube", discord: "Discord voice",
};

export const CHANNEL_ICON: Record<Channel, string> = {
  linkedin: "in", medium: "M", substack: "S",
  instagram: "IG", facebook: "f",
  x: "X", youtube: "YT", discord: "DC",
};

/** What a slot is for — it decides the kind of idea that suits it. */
export type SlotKind =
  | "longform"   // LinkedIn + Medium + Substack, the same argument in three lengths
  | "visual"     // Instagram + Facebook
  | "oneline"    // X
  | "video"      // YouTube
  | "meeting";   // Discord voice — nothing is posted, somebody turns up

export type Slot = {
  /** YYYY-MM-DD */
  date: string;
  /** 24-hour IST, "HH:MM" */
  time: string;
  kind: SlotKind;
  channels: Channel[];
  /** What this slot is for, in the founder's terms. */
  purpose: string;
};

// Anchored to a real Monday so "every other day" and "every second Saturday"
// never drift, whichever week the plan is generated in. Any fixed Monday would
// do; this one is the Monday of the week the site opened to students.
const ANCHOR = Date.UTC(2026, 7, 3); // 3 August 2026, a Monday

const DAY = 86400000;
const daysFromAnchor = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - ANCHOR) / DAY);

/** 0 = Sunday … 6 = Saturday, read off the date string, not the local clock. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** The Monday on or before a date — a plan is always a Monday-to-Sunday week. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/**
 * Every slot for one day.
 *
 * Times are IST and chosen for when the audience is actually there: one line
 * on X with the morning tea, long-form mid-morning when LinkedIn is read, the
 * picture in the evening, the video after dinner.
 */
export function slotsForDay(iso: string): Slot[] {
  const dow = weekdayOf(iso);
  const n = daysFromAnchor(iso);
  const out: Slot[] = [];

  // Every day, without exception. The cheapest habit to keep and the one that
  // keeps the account alive between the bigger pieces.
  out.push({
    date: iso, time: "08:30", kind: "oneline", channels: ["x"],
    purpose: "One useful line — a concept put plainly, no link needed.",
  });

  // Wednesday and Friday: the same argument, written once and cut three ways.
  if (dow === 3 || dow === 5) {
    out.push({
      date: iso, time: "10:30", kind: "longform", channels: ["linkedin", "medium", "substack"],
      purpose: "One piece of thinking, at three lengths: a LinkedIn post, a Medium article, a Substack letter.",
    });
  }

  // Every other day. Anchored, so it alternates for ever without anyone
  // remembering whose turn it was.
  if (n % 2 === 0) {
    out.push({
      date: iso, time: "18:30", kind: "visual", channels: ["instagram", "facebook"],
      purpose: "Something to look at — a worked step, a summary card, a note from the class.",
    });
  }

  // Monday, Thursday, Saturday.
  if (dow === 1 || dow === 4 || dow === 6) {
    out.push({
      date: iso, time: "19:30", kind: "video", channels: ["youtube"],
      purpose: "A short teaching video on one topic — the thing students get wrong about it.",
    });
  }

  // Saturday evening, every second week. Nova Seed Capital, not the classes.
  if (dow === 6 && Math.floor(n / 7) % 2 === 0) {
    out.push({
      date: iso, time: "20:30", kind: "meeting", channels: ["discord"],
      purpose: "Nova Seed Capital voice meeting — nothing is published, somebody has to be there.",
    });
  }

  return out;
}

/** Monday to Sunday, in order. `from` may be any day of that week. */
export function slotsForWeek(from: string): Slot[] {
  const monday = weekStart(from);
  const out: Slot[] = [];
  for (let i = 0; i < 7; i++) out.push(...slotsForDay(addDays(monday, i)));
  return out;
}

/** "Monday, 17 August" — the heading a day gets on the plan. */
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * How this rhythm reads back in words, for the top of the page.
 *
 * Kept beside the code that implements it so the two cannot say different
 * things — a schedule described one way and executed another is worse than no
 * description at all.
 */
export const RHYTHM_IN_WORDS: { what: string; when: string }[] = [
  { what: "X (Twitter)", when: "Every day, 8:30 am" },
  { what: "LinkedIn + Medium + Substack", when: "Wednesday and Friday, 10:30 am" },
  { what: "Instagram + Facebook", when: "Every alternate day, 6:30 pm" },
  { what: "YouTube video", when: "Monday, Thursday and Saturday, 7:30 pm" },
  { what: "Discord voice — Nova Seed Capital", when: "Every second Saturday, 8:30 pm" },
];
