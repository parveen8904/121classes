// Exam-attempt filtering. Attempts are free-text (e.g. "MAY_2026", "Nov 2026").
// We parse them to a sortable rank (year*12 + month) so a topic's validity
// window can be compared against the student's target attempt.

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function attemptRank(a?: string | null): number | null {
  if (!a) return null;
  const up = a.toUpperCase();
  const m = up.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[^0-9]*(\d{4})/);
  if (m) return Number(m[2]) * 12 + MONTHS[m[1]];
  const y = up.match(/(\d{4})/);
  if (y) return Number(y[1]) * 12; // year-only fallback
  return null;
}

// A topic is visible to a student if their target attempt falls within the
// topic's validity window. Unset target or unparseable bounds are permissive.
export function topicVisible(
  target: string | null | undefined,
  from?: string | null,
  to?: string | null,
): boolean {
  const t = attemptRank(target ?? null);
  if (t === null) return true; // no target set → show everything
  const f = attemptRank(from);
  const e = attemptRank(to);
  if (f !== null && t < f) return false;
  if (e !== null && t > e) return false;
  return true;
}
