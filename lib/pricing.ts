// Subscription pricing. `web_price_inr` on a plan is the per-month base; the
// final price scales with duration, with a longer-term discount. All of this
// is intended to become admin-configurable later — for now the discount curve
// lives here in one place.

export const DURATIONS = [1, 3, 6, 12] as const;
export type DurationMonths = (typeof DURATIONS)[number];

// Discount applied to the gross (perMonth × months) for longer commitments.
export function durationDiscount(months: number): number {
  switch (months) {
    case 12:
      return 0.2;
    case 6:
      return 0.1;
    case 3:
      return 0.05;
    default:
      return 0;
  }
}

export function computePrice(perMonth: number | null | undefined, months: number): number {
  const base = perMonth ?? 0;
  const gross = base * months;
  return Math.round(gross * (1 - durationDiscount(months)));
}

export function durationLabel(months: number): string {
  return months === 1 ? "1 month" : `${months} months`;
}

export function formatINR(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}
