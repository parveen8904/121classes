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

// Twelve months, Gold. The only shape a supporter sells.
export const SELL_MONTHS = 12;
export const SELL_TIER = "gold";

export type SellableProduct = {
  id: string;
  title: string;
  course: string;
  priceInr: number;
  months: number;
};

/** The two products, priced exactly as a student would be charged. */
export async function sellableProducts(): Promise<SellableProduct[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("subjects")
    .select("id, title, gold_price_inr, gold_slabs, validity_months, courses:course_id(title)")
    .in("title", SELLABLE.map((p) => p.title));

  const { parseSlabs, slabTotal } = await import("@/lib/pricing");
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
    const price = slabs
      ? slabTotal(slabs, SELL_MONTHS)
      : base > 0
        ? Math.max(1, Math.round((base * SELL_MONTHS) / baseMonths))
        : 0;
    if (price <= 0) continue;
    out.push({
      id: row.id as string,
      title: row.title as string,
      course: ((row as { courses?: { title?: string } | null }).courses?.title) ?? want.course,
      priceInr: price,
      months: SELL_MONTHS,
    });
  }
  return out;
}

/** Is this subject one a supporter is allowed to sell? */
export async function isSellable(subjectId: string): Promise<boolean> {
  return (await sellableProducts()).some((p) => p.id === subjectId);
}
