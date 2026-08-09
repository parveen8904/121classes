import { createServiceClient } from "@/lib/supabase/service";

// WHAT A SUPPORTER MAY SELL.
//
// Two products. Not "everything on the site, filtered" — two, named here, so
// nothing new can quietly become sellable by being added to the catalogue.
// A supporter is not a shop; they carry two lines.
//
// Held by title rather than by id so the list still reads as itself, and so
// renaming a subject in the admin cannot silently empty the catalogue without
// somebody noticing the name no longer matches.
export const SELLABLE = [
  { title: "Advanced Accounting", course: "CA Intermediate" },
  { title: "Financial Reporting", course: "CA Final" },
] as const;

// Gold, and never less than a year. A supporter may sell a LONGER term than
// twelve months — a student sitting a later attempt needs the access to reach
// it — but not a shorter one, because the short slabs are priced for students
// topping up, not for a first sale.
export const SELL_MONTHS = 12;
export const SELL_MIN_MONTHS = 12;
export const SELL_MAX_MONTHS = 24;
export const SELL_TIER = "gold";

export type SellOption = { months: number; priceInr: number };

export type SellableProduct = {
  id: string;
  title: string;
  course: string;
  /** The twelve-month price — what the card shows before a term is chosen. */
  priceInr: number;
  months: number;
  /** Every term on offer, priced on the student ladder. */
  options: SellOption[];
};

/** The two products, priced exactly as a student would be charged. */
export async function sellableProducts(): Promise<SellableProduct[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("subjects")
    .select("id, title, gold_price_inr, gold_slabs, validity_months, courses:course_id(title)")
    .in("title", SELLABLE.map((p) => p.title));

  const { parseSlabs, slabTotal, slabMonthOptions } = await import("@/lib/pricing");
  const out: SellableProduct[] = [];

  for (const want of SELLABLE) {
    const row = (data ?? []).find((r) => (r.title as string) === want.title);
    if (!row) continue;
    // The SAME ladder a student is charged on. A supporter's customer must
    // never be quoted a different figure from the public one — the discount
    // comes from a coupon, openly, not from a second price list.
    const slabs = parseSlabs((row as { gold_slabs?: unknown }).gold_slabs);
    const base = Number((row as { gold_price_inr?: number | null }).gold_price_inr) || 0;
    const baseMonths = Number((row as { validity_months?: number | null }).validity_months) || 12;
    const priceFor = (m: number) =>
      slabs
        ? slabTotal(slabs, m)
        : base > 0
          ? Math.max(1, Math.round((base * m) / baseMonths))
          : 0;

    const price = priceFor(SELL_MONTHS);
    if (price <= 0) continue;

    // The ladder's own boundaries from twelve months up — those are the real
    // price points — plus the midpoint between the last two, so a supporter is
    // not forced to jump from one year straight to two.
    const boundaries = slabs
      ? slabMonthOptions(slabs).filter((m) => m >= SELL_MIN_MONTHS && m <= SELL_MAX_MONTHS)
      : [SELL_MONTHS];
    const terms = new Set<number>([SELL_MONTHS, ...boundaries]);
    if (boundaries.includes(SELL_MAX_MONTHS)) terms.add(Math.round((SELL_MONTHS + SELL_MAX_MONTHS) / 2));

    out.push({
      id: row.id as string,
      title: row.title as string,
      course: ((row as { courses?: { title?: string } | null }).courses?.title) ?? want.course,
      priceInr: price,
      months: SELL_MONTHS,
      options: [...terms].sort((a, b) => a - b)
        .map((m) => ({ months: m, priceInr: priceFor(m) }))
        .filter((o) => o.priceInr > 0),
    });
  }
  return out;
}

/** Is this subject one a supporter is allowed to sell? */
export async function isSellable(subjectId: string): Promise<boolean> {
  return (await sellableProducts()).some((p) => p.id === subjectId);
}
