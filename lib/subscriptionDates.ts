/**
 * When a subscription ends, and where an extension starts counting from.
 *
 * Kept out of the enrolment actions file because a "use server" module may only
 * export async functions — and kept free of imports so it can be unit-tested.
 */

/**
 * setMonth OVERFLOWS. 31 January plus one month is 3 March, because February
 * has no 31st and JavaScript rolls forward instead of clamping. A student given
 * twelve months from the 31st would silently gain a day or two; repeated across
 * a batch it drifts. Clamp to the last day of the target month, which is what
 * "a month later" means to everyone but a computer.
 */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * WHERE AN EXTENSION STARTS COUNTING.
 *
 * His instruction, 31 August 2026: months added to a subscription that has NOT
 * yet expired run from the EXISTING EXPIRY, not from today. Extend a student on
 * 30 August whose access runs to 30 September and they should end on 30
 * November, not 30 October — otherwise every early extension quietly eats the
 * time they had left, which is exactly the complaint on ticket TKT-01283.
 *
 * Where access has already lapsed there is nothing to follow on from, so it
 * runs from today. This is what Edmingle does and what the desk has been
 * assuming all along.
 */
export function extendedEndsAt(
  currentEndsAt: string | null,
  months: number,
  now: Date = new Date(),
): string {
  const current = currentEndsAt ? new Date(currentEndsAt) : null;
  const base = current && current > now ? current : now;
  return addMonths(base, months).toISOString();
}

/** A fresh grant always runs from today. */
export function endsAtFromNow(months: number, now: Date = new Date()): string {
  return addMonths(now, months).toISOString();
}
