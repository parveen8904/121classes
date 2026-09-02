// WHICH EXAM EVERYONE IS SITTING NEXT.
//
// The attempt was written into the page text in eight files — the mock-tests
// page, its metadata, the PDF header, the papers the admin creates, the course
// applicability windows, a campaign placeholder. So "September 2026" survived
// the September 2026 exams in six places at once, and a student arriving on
// 1 September was told the mock papers were for an exam they had just sat.
//
// It is one line now. After every attempt, change NEXT below and the whole
// portal follows: page titles, the badge, the PDF header, the default label on
// new mock papers, and the applicability window on every course card.
//
// CA exams are held in January, May and September.

export const NEXT = {
  /** CA Intermediate. His instruction, 1 September 2026: September is over,
   *  the next one is January 2027. */
  inter: "January 2027",
  /** CA Final. NOT changed on 1 September — he named Intermediate only, and
   *  guessing the Final calendar would put a wrong date on his own subject.
   *  Confirm and change this line. */
  final: "November 2026",
} as const;

/** How long a subject's content stays applicable, shown when no explicit
 *  window is set on the subject itself. The admin overrides per subject. */
export const APPLICABILITY = {
  inter: { from: NEXT.inter, to: "May 2028" },
  final: { from: NEXT.final, to: "November 2028" },
} as const;

type Level = "inter" | "final";

/** "CA Intermediate" / "CA Final" → the key, from whatever the course is called. */
export function levelOf(courseTitle: string): Level | null {
  const t = (courseTitle || "").toLowerCase();
  if (t.includes("final")) return "final";
  if (t.includes("inter")) return "inter";
  return null;
}

/** The applicability window for a course, or null if it is neither level. */
export function levelWindow(courseTitle: string): { from: string; to: string } | null {
  const l = levelOf(courseTitle);
  return l ? { ...APPLICABILITY[l] } : null;
}

/** "January 2027 up to May 2028" — the same window as one line of prose. */
export function levelWindowLabel(courseTitle: string): string {
  const w = levelWindow(courseTitle);
  return w ? `${w.from} up to ${w.to}` : "";
}

/** Month number for the four months CA exams are held in. */
const MONTH_NO: Record<string, number> = {
  january: 1, may: 5, september: 9, november: 11,
  // Tolerated because older rows carry them.
  february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, october: 10, december: 12,
};

/**
 * HAS THIS ATTEMPT ALREADY BEEN SAT?
 *
 * On 1 September 2026, 242 students still had "September 2026" saved as the
 * exam they were preparing for — an exam that had just finished. Nothing asked
 * them to move it on, because the only check anywhere was whether the field was
 * EMPTY. So their planner counted down to a date in the past and their
 * amendments were filtered for a sitting that was over.
 *
 * An attempt counts as past once its month has ended.
 */
export function isPastAttempt(attempt: string | null | undefined, now: Date = new Date()): boolean {
  const m = String(attempt ?? "").replace(/_/g, " ").trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return false;                       // unparseable is not "past"
  const month = MONTH_NO[m[1].toLowerCase()];
  if (!month) return false;
  const year = Number(m[2]);
  // Past once the month itself is over: September 2026 is past from 1 October.
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
}
