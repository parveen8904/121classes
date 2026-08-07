// WHEN A SOLD SUBSCRIPTION RUNS, and what fills the gap before it.
//
// Pulled out of the payment handler so the rule can be run and checked without
// taking money. The handler is behind a live payment gateway; this is the part
// that decides what a student actually gets, and it is the part worth being
// sure about.
//
// Two jobs:
//  · the paid plan runs from the date it was SOLD FOR, not the date the money
//    arrived — selling in July for an October start must not cost the student
//    the three months in between;
//  · when that date is in the future, Bronze covers the gap, so the student can
//    sign in the same day and watch the demo classes instead of meeting an
//    account that shows them nothing.

export type PlanWindow = {
  /** Bronze, from now until the paid plan begins. Null when it starts today. */
  bridge: { startsAt: Date; endsAt: Date } | null;
  /** The paid plan. */
  paid: { startsAt: Date; endsAt: Date };
};

export function planWindow(
  startsOn: string | Date | null | undefined,
  months: number,
  now: Date = new Date(),
): PlanWindow {
  const m = Math.max(1, Math.round(Number(months) || 12));

  const soldFor = startsOn ? new Date(startsOn) : null;
  const valid = soldFor && !Number.isNaN(soldFor.getTime());
  // A date already gone simply means "now" — a supporter typing yesterday's
  // date should not shorten anything, and must not push the start backwards.
  const startsAt = valid && soldFor!.getTime() > now.getTime() ? soldFor! : new Date(now);

  const endsAt = new Date(startsAt);
  endsAt.setMonth(endsAt.getMonth() + m);

  const bridge =
    startsAt.getTime() > now.getTime()
      ? { startsAt: new Date(now), endsAt: new Date(startsAt) }
      : null;

  return { bridge, paid: { startsAt, endsAt } };
}
