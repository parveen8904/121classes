import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";

// TAX WORKSHEETS — projections with the working shown, never a filing.
//
// India: FY-to-date profit straight from the live Zoho chart balances,
// annualised, taxed at the founder's own assumed effective rate, less TDS
// suffered and advance tax already paid — against the 15/45/75/100 ladder.
// US (green-card holder): the 110%-of-prior-year safe harbour split over the
// 1040-ES quarters, less what's already paid. He is the CA; the engine does
// the arithmetic and shows every input it used.

export type FyPnl = {
  income: number; expenses: number; pbt: number;
  tdsFytd: number; advancePaid: number; usEstPaidInr: number;
  monthsElapsed: number;
};

const num = (v: unknown) => Number(v) || 0;

/** Live FY-to-date P&L + tax credits, read from the Zoho chart balances. */
export async function fySnapshot(): Promise<FyPnl> {
  type Acct = { account_name: string; account_type: string; current_balance?: number };
  // "IT SAYS ZERO EXPENSE. IT IS WRONG." — 5 September 2026. He is right, and
  // this page walked into BOTH of the traps lib/bankStatements.ts already has
  // written down beside the same endpoint. They compound.
  //
  //   1. "AccountType.Active" sounds like active accounts and is not. Under it
  //      Zoho returns not one expense head — no expense, no other_expense, no
  //      cost of goods sold. Checked against his books today: it hands back
  //      assets, income, liabilities and equity, and nothing else.
  //
  //   2. has_more_page LIES. Under AccountType.All page 2 reports
  //      has_more_page: false, and page 3 then hands over 119 more accounts —
  //      which happen to be EVERY expense head in the chart, 108 of them
  //      totalling ₹46,74,879.78. So the loop must read until a page comes
  //      back EMPTY, never until the flag says stop.
  //
  // With expenses reading zero the profit was the whole turnover, and the
  // advance-tax instalment suggested for 15 September came out ₹13,98,454
  // higher than the figures support. A tax page that is confidently wrong is
  // worse than no tax page.
  const accts: Acct[] = [];
  for (let page = 1; page <= 12; page++) {
    const r = await zohoFetch<{ chartofaccounts?: Acct[] }>(
      "/chartofaccounts", { query: { filter_by: "AccountType.All", per_page: "200", page: String(page), showbalance: "true" } });
    const batch = r.chartofaccounts ?? [];
    if (!batch.length) break;
    accts.push(...batch);
  }
  // A chart with no expense head at all is not a business with no costs — it is
  // this bug coming back. Refuse rather than publish a profit that is really a
  // turnover; the page shows the reason instead of a number.
  const expenseHeads = accts.filter((a) => ["expense", "cost_of_goods_sold", "other_expense"].includes(a.account_type)).length;
  if (accts.length && expenseHeads === 0) {
    throw new Error(
      "Zoho returned a chart of accounts with no expense head at all, which cannot be right — "
      + "the profit below would be the whole turnover. Nothing is shown rather than a figure that would overstate the tax.",
    );
  }
  const sum = (types: string[]) => accts.filter((a) => types.includes(a.account_type)).reduce((s, a) => s + num(a.current_balance), 0);
  const income = sum(["income", "other_income"]);
  const expenses = sum(["expense", "cost_of_goods_sold", "other_expense"]);

  const byName = (re: RegExp) => accts.filter((a) => re.test(a.account_name)).reduce((s, a) => s + num(a.current_balance), 0);
  // Current income year FY26-27 → assessment year 2027-28.
  const tdsFytd = byName(/TDS Receivables? (AY|TY) ?20?27-?28|TDS Receivables TY 26-27/i);
  const advancePaid = byName(/Advance Tax A\.?Y\.? ?20?27-?28/i);
  const usEstPaidInr = byName(/US Estimated Tax[- ]?20?26/i);

  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const m = ist.getMonth() + 1; // 1..12
  const monthsElapsed = m >= 4 ? m - 3 : m + 9;

  return { income, expenses, pbt: income - expenses, tdsFytd, advancePaid, usEstPaidInr, monthsElapsed };
}

export type IndiaAdvTax = {
  annualisedPbt: number; effRate: number; estTax: number;
  instalments: { due: string; cumPct: number; cumRequired: number }[];
  nextDue: string; nextRequired: number; paidSoFar: number; tds: number;
};

export function indiaAdvanceTax(s: FyPnl, effRatePct: number): IndiaAdvTax {
  const annualisedPbt = s.monthsElapsed > 0 ? (s.pbt / s.monthsElapsed) * 12 : 0;
  const estTax = Math.max(0, annualisedPbt * (effRatePct / 100));
  const netAfterTds = Math.max(0, estTax - s.tdsFytd);
  const ladder = [
    { due: "2026-06-15", cumPct: 15 },
    { due: "2026-09-15", cumPct: 45 },
    { due: "2026-12-15", cumPct: 75 },
    { due: "2027-03-15", cumPct: 100 },
  ];
  const instalments = ladder.map((l) => ({ ...l, cumRequired: Math.round(netAfterTds * (l.cumPct / 100)) }));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const next = instalments.find((i) => i.due >= today) ?? instalments[instalments.length - 1];
  return {
    annualisedPbt, effRate: effRatePct, estTax,
    instalments, nextDue: next.due,
    nextRequired: Math.max(0, next.cumRequired - s.advancePaid),
    paidSoFar: s.advancePaid, tds: s.tdsFytd,
  };
}

export type UsEstTax = {
  priorYearTaxUsd: number; safeHarbourUsd: number; quarterlyUsd: number;
  quarters: { due: string; label: string }[]; nextDue: string;
};

export function usEstimatedTax(priorYearTaxUsd: number): UsEstTax {
  const safeHarbourUsd = priorYearTaxUsd * 1.1;
  const quarters = [
    { due: "2026-04-15", label: "Q1 2026" },
    { due: "2026-06-15", label: "Q2 2026" },
    { due: "2026-09-15", label: "Q3 2026" },
    { due: "2027-01-15", label: "Q4 2026" },
  ];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const next = quarters.find((q) => q.due >= today) ?? quarters[quarters.length - 1];
  return { priorYearTaxUsd, safeHarbourUsd, quarterlyUsd: safeHarbourUsd / 4, quarters, nextDue: next.due };
}

// Assumptions live in site_settings so the founder can tune them on the hub.
export async function taxAssumptions(): Promise<{ effRatePct: number; usPriorYearTaxUsd: number }> {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("key, value").in("key", ["adv_tax_eff_rate", "us_py_tax_usd"]);
  const m = new Map((data ?? []).map((r) => [r.key, r.value]));
  return {
    effRatePct: Number(m.get("adv_tax_eff_rate")) || 31.2,
    usPriorYearTaxUsd: Number(m.get("us_py_tax_usd")) || 0,
  };
}
