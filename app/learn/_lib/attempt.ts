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

// Topics are shown to every student by default — the attempt window must never
// hide a topic (founder directive, 2026-06-21). We keep the signature and the
// attemptRank helper so the validity dates can still be displayed, but visibility
// is always permissive.
export function topicVisible(
  _target?: string | null,
  _from?: string | null,
  _to?: string | null,
): boolean {
  return true;
}
