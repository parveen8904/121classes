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

// ---- Stacked-slab (marginal) subscription pricing --------------------------
// Each slab caps a month range at a per-month rate; the total for N months is
// the sum across slabs — like tax brackets. e.g.
// [{upto:3,rate:600},{upto:6,rate:500},{upto:12,rate:400},{upto:24,rate:300}]
//   6 months = 3×600 + 3×500 = 3300 ; 12 = 3300 + 6×400 = 5700.
export type Slab = { upto: number; rate: number };

// Parse + sanitise a slabs value from the DB (jsonb). null → caller falls back
// to the old flat/linear pricing for that tier.
export function parseSlabs(raw: unknown): Slab[] | null {
  const arr = Array.isArray(raw) ? raw : null;
  if (!arr) return null;
  const slabs = arr
    .map((s) => ({ upto: Number((s as Slab)?.upto), rate: Number((s as Slab)?.rate) }))
    .filter((s) => Number.isFinite(s.upto) && s.upto > 0 && Number.isFinite(s.rate) && s.rate >= 0)
    .sort((a, b) => a.upto - b.upto);
  return slabs.length ? slabs : null;
}

// Total ₹ for `months` under a slab ladder. Months beyond the last cap continue
// at the last slab's rate.
export function slabTotal(slabs: Slab[], months: number): number {
  const n = Math.max(1, Math.round(months));
  let prev = 0, total = 0, lastRate = slabs[0]?.rate ?? 0;
  for (const s of slabs) {
    if (n <= prev) break;
    const inSlab = Math.min(n, s.upto) - prev;
    if (inSlab > 0) total += inSlab * s.rate;
    prev = s.upto;
    lastRate = s.rate;
  }
  if (n > prev) total += (n - prev) * lastRate;
  return Math.max(1, Math.round(total));
}

// The meaningful month options a ladder offers: 1 + each cap boundary.
export function slabMonthOptions(slabs: Slab[]): number[] {
  const set = new Set<number>([1]);
  for (const s of slabs) set.add(s.upto);
  return [...set].sort((a, b) => a - b);
}
