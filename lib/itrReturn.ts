import { zohoFetch } from "@/lib/zohoApi";
import { createServiceClient } from "@/lib/supabase/service";

// THE RETURN, BUILT FROM THE BOOKS RATHER THAN RE-KEYED FROM THEM.
//
// His accountant does this by hand every year: take the Zoho ledgers, decide
// which belong to the business and which are personal, draw a balance sheet and
// a profit and loss for the business alone, derive drawings as the balancing
// figure, push everything else into Schedule AL, and write a computation. The
// judgement in that is real and it stays his. What is NOT judgement is the
// arithmetic and the completeness — and that is exactly where the FY 2025-26
// audit found the errors: one operating expense silently dropped, ₹73 lakh of
// exchange difference left in no schedule at all, ₹1.96 crore of assets in
// neither statement, two accounts double counted.
//
// So the mapping is the product. Every Zoho ledger is assigned a destination
// once; from then on nothing can fall through, because a ledger with no
// destination is reported as unmapped instead of quietly ignored. Change a
// destination and all three outputs move together.

export type PlBucket =
  | "BUS_REV" | "BUS_OTHINC" | "BUS_COGS" | "BUS_EMP" | "BUS_FIN" | "BUS_DEP" | "BUS_OTHEXP"
  | "HP" | "HP_TAX"
  | "OS_INT_SB" | "OS_INT_FD" | "OS_INT_BOND" | "OS_INT_SGB" | "OS_INT_OTHER"
  | "OS_DIV" | "OS_ROYALTY" | "OS_OTHER"
  | "SPEC" | "CG" | "PERSONAL";

export type BsBucket =
  | "BIZ_PPE" | "BIZ_RECV" | "BIZ_CASH" | "BIZ_OCA" | "BIZ_PAY" | "BIZ_OCL"
  | "AL_IMMOV" | "AL_JEWEL" | "AL_VEHICLE" | "AL_BANK" | "AL_SHARES" | "AL_LOANS"
  | "AL_CASH" | "AL_LIAB" | "EQUITY";

export const PL_BUCKETS: { key: PlBucket; label: string; group: string }[] = [
  { key: "BUS_REV", label: "Revenue from operations", group: "Business" },
  { key: "BUS_OTHINC", label: "Other income", group: "Business" },
  { key: "BUS_COGS", label: "Cost of goods sold", group: "Business" },
  { key: "BUS_EMP", label: "Employee benefits", group: "Business" },
  { key: "BUS_FIN", label: "Finance cost", group: "Business" },
  { key: "BUS_DEP", label: "Depreciation", group: "Business" },
  { key: "BUS_OTHEXP", label: "Other expenses", group: "Business" },
  { key: "HP", label: "Rent received", group: "House property" },
  { key: "HP_TAX", label: "Municipal tax paid", group: "House property" },
  { key: "OS_INT_SB", label: "Interest — savings bank", group: "Other sources" },
  { key: "OS_INT_FD", label: "Interest — fixed deposits", group: "Other sources" },
  { key: "OS_INT_BOND", label: "Interest — bonds", group: "Other sources" },
  { key: "OS_INT_SGB", label: "Interest — sovereign gold bonds", group: "Other sources" },
  { key: "OS_INT_OTHER", label: "Interest — other", group: "Other sources" },
  { key: "OS_DIV", label: "Dividend", group: "Other sources" },
  { key: "OS_ROYALTY", label: "Royalty", group: "Other sources" },
  { key: "OS_OTHER", label: "Other income", group: "Other sources" },
  { key: "SPEC", label: "Speculation business", group: "Separate heads" },
  { key: "CG", label: "Capital gains", group: "Separate heads" },
  { key: "PERSONAL", label: "Personal — drawings, not in the return", group: "Separate heads" },
];

export const BS_BUCKETS: { key: BsBucket; label: string; group: string }[] = [
  { key: "BIZ_PPE", label: "Property, plant and equipment", group: "Business balance sheet" },
  { key: "BIZ_RECV", label: "Trade receivables", group: "Business balance sheet" },
  { key: "BIZ_CASH", label: "Cash and bank", group: "Business balance sheet" },
  { key: "BIZ_OCA", label: "Other current assets", group: "Business balance sheet" },
  { key: "BIZ_PAY", label: "Trade payables", group: "Business balance sheet" },
  { key: "BIZ_OCL", label: "Other current liabilities", group: "Business balance sheet" },
  { key: "AL_IMMOV", label: "Immovable property", group: "Schedule AL" },
  { key: "AL_JEWEL", label: "Jewellery, bullion", group: "Schedule AL" },
  { key: "AL_VEHICLE", label: "Vehicles, boats, aircraft", group: "Schedule AL" },
  { key: "AL_BANK", label: "Bank balances and deposits", group: "Schedule AL" },
  { key: "AL_SHARES", label: "Shares and securities", group: "Schedule AL" },
  { key: "AL_LOANS", label: "Loans and advances given", group: "Schedule AL" },
  { key: "AL_CASH", label: "Cash in hand", group: "Schedule AL" },
  { key: "AL_LIAB", label: "Liabilities against those assets", group: "Schedule AL" },
  { key: "EQUITY", label: "Capital / drawings — computed, never carried", group: "Schedule AL" },
];

/** The figures that are not in Zoho and have to be told to it once a year. */
export type YearInputs = {
  openingCapital: number;      // owner's capital at the start of the year
  capitalIntroduced: number;
  auditFeeProvision: number;
  depreciationPerItChart: number;   // s.32 chart, not the books
  broughtForwardStcl: number;
  broughtForwardLtcl: number;
  hpOwnershipShare: Record<string, number>;  // rent ledger -> % held, default 100
  hpGrossUp: Record<string, number>;         // rent ledger -> 100% annual value when the books hold only his share
  hpMunicipalTax: Record<string, number>;    // rent ledger -> municipal tax paid on that property
  closingUsdRate: number;      // SBI TT buy on the last day, for restating foreign balances
  usdBalances: Record<string, number>;       // ledger -> foreign-currency balance at year end
  notes: string;
};

export const EMPTY_INPUTS: YearInputs = {
  openingCapital: 0, capitalIntroduced: 0, auditFeeProvision: 0,
  depreciationPerItChart: 0, broughtForwardStcl: 0, broughtForwardLtcl: 0,
  hpOwnershipShare: {}, hpGrossUp: {}, hpMunicipalTax: {},
  closingUsdRate: 0, usdBalances: {}, notes: "",
};

export type LedgerRow = { ledger: string; amount: number; path: string; bucket: string | null };

export type ReturnPack = {
  fy: string;
  from: string;
  to: string;
  pl: LedgerRow[];
  bs: LedgerRow[];
  unmappedPl: string[];
  unmappedBs: string[];
  totals: Record<string, number>;
  business: {
    revenue: number; otherIncome: number; totalIncome: number;
    cogs: number; employee: number; finance: number; depreciation: number; otherExpenses: number;
    totalExpenses: number; profit: number;
    assets: { label: string; amount: number }[];
    liabilities: { label: string; amount: number }[];
    totalAssets: number; totalLiabilities: number;
    closingCapital: number; drawings: number;
  };
  computation: {
    houseProperty: { property: string; annualValue: number; municipalTax: number; share: number; netAfterShare: number; standardDeduction: number; income: number }[];
    housePropertyTotal: number;
    businessIncome: number;
    speculation: number;
    capitalGains: { gross: number; setOff: number; taxable: number; carriedForward: number };
    otherSources: { label: string; amount: number }[];
    otherSourcesTotal: number;
    grossTotalIncome: number;
    totalIncome: number;
    tax: number; surcharge: number; cess: number; totalTax: number;
  };
  scheduleAl: { category: string; rows: { ledger: string; amount: number; restated: boolean; foreign: number | null }[]; total: number }[];
  builtAt: string;
};

const round = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- Zoho reads
type ZohoNode = {
  name?: string; total_label?: string; total?: number; account_id?: string;
  account_transactions?: ZohoNode[];
};

function flatten(nodes: ZohoNode[] | undefined, path: string[], out: LedgerRow[]) {
  for (const n of nodes ?? []) {
    const name = n.name ?? n.total_label ?? "";
    if (n.account_id) {
      out.push({ ledger: name, amount: Number(n.total ?? 0), path: path.join(" > "), bucket: null });
    }
    if (n.account_transactions) flatten(n.account_transactions, name ? [...path, name] : path, out);
  }
}

export async function fetchZohoLedgers(from: string, to: string) {
  const pl = await zohoFetch<{ profit_and_loss?: ZohoNode[] }>("/reports/profitandloss", {
    query: { from_date: from, to_date: to },
  });
  const bs = await zohoFetch<{ balance_sheet?: ZohoNode[] }>("/reports/balancesheet", {
    query: { to_date: to },
  });
  const plRows: LedgerRow[] = []; flatten(pl.profit_and_loss, [], plRows);
  const bsRows: LedgerRow[] = []; flatten(bs.balance_sheet, [], bsRows);
  return { plRows, bsRows };
}

// A Zoho P&L reports expenses as positive numbers under an expense heading.
// Signing them here once means every downstream total is a plain sum.
const isExpensePath = (p: string) => /Expense|Cost of Goods/i.test(p);
export const signed = (r: LedgerRow) => (isExpensePath(r.path) ? -r.amount : r.amount);

// A LOAN ACCOUNT THAT HAS GONE INTO DEBIT IS AN ASSET.
//
// "Loan from Ruchi Sharma" sits in the liabilities side of the balance sheet
// with a MINUS ₹62.65 lakh balance — more has been paid back than was borrowed,
// so what is left is money recoverable. Reported as a liability of minus 62
// lakh it silently reduces the liability total; reported where it belongs, it
// is an asset of 62 lakh. The rule is general: a balance that has crossed to
// the other side of the sheet is signed by the bucket it was put in, not by the
// side of the sheet Zoho happens to keep it on.
const AL_ASSET_BUCKETS = new Set<string>([
  "AL_IMMOV", "AL_JEWEL", "AL_VEHICLE", "AL_BANK", "AL_SHARES", "AL_LOANS", "AL_CASH",
  "BIZ_PPE", "BIZ_RECV", "BIZ_CASH", "BIZ_OCA",
]);
export function bsAmount(r: LedgerRow): number {
  const onLiabilitySide = /Liabilit/i.test(r.path);
  if (r.bucket && onLiabilitySide && AL_ASSET_BUCKETS.has(r.bucket)) return -r.amount;
  if (r.bucket && !onLiabilitySide && (r.bucket === "AL_LIAB" || r.bucket === "BIZ_PAY" || r.bucket === "BIZ_OCL")) return -r.amount;
  return r.amount;
}

// ---------------------------------------------------------------- the mapping
/**
 * The mapping in force: the suggested one from code, with whatever the desk has
 * changed laid over the top. Doing it this way round means a fresh database is
 * never empty, and a ledger Zoho grows next year that happens to be one of the
 * known names is placed without anybody being asked twice.
 */
export async function loadMap() {
  const svc = createServiceClient();
  const { data } = await svc.from("itr_ledger_map").select("ledger, kind, bucket");
  const pl: Record<string, string> = { ...DEFAULT_PL_MAP };
  const bs: Record<string, string> = { ...DEFAULT_BS_MAP };
  let overrides = 0;
  for (const r of data ?? []) { (r.kind === "pl" ? pl : bs)[r.ledger] = r.bucket; overrides++; }
  return { pl, bs, overrides };
}

export async function loadYear(fy: string): Promise<{ inputs: YearInputs; snapshot: ReturnPack | null; builtAt: string | null }> {
  const svc = createServiceClient();
  const { data } = await svc.from("itr_years").select("inputs, snapshot, built_at").eq("fy", fy).maybeSingle();
  return {
    inputs: { ...EMPTY_INPUTS, ...((data?.inputs as Partial<YearInputs>) ?? {}) },
    snapshot: (data?.snapshot as ReturnPack | null) ?? null,
    builtAt: (data?.built_at as string | null) ?? null,
  };
}

/** '2025-26' -> 1 April 2025 to 31 March 2026. */
export function fyDates(fy: string) {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

// ---------------------------------------------------------------- tax
// New regime, s.115BAC, as it stands for A.Y. 2026-27. Surcharge is capped at
// 25% there — the 37% slab does not exist under 115BAC.
const SLABS: [number, number][] = [
  [400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25],
];
export function taxNewRegime(ti: number) {
  let t = 0, prev = 0;
  for (const [cap, rate] of SLABS) { if (ti > prev) t += (Math.min(ti, cap) - prev) * rate; prev = cap; }
  if (ti > 2400000) t += (ti - 2400000) * 0.30;
  return t;
}
function surchargeRate(ti: number) {
  if (ti > 20000000) return 0.25;
  if (ti > 10000000) return 0.15;
  if (ti > 5000000) return 0.10;
  return 0;
}

// ---------------------------------------------------------------- the build
export function buildPack(p: {
  fy: string; from: string; to: string;
  plRows: LedgerRow[]; bsRows: LedgerRow[];
  map: { pl: Record<string, string>; bs: Record<string, string> };
  inputs: YearInputs;
}): ReturnPack {
  const { fy, from, to, inputs } = p;
  const pl = p.plRows.map((r) => ({ ...r, bucket: p.map.pl[r.ledger] ?? null }));
  const bs = p.bsRows.map((r) => ({ ...r, bucket: p.map.bs[r.ledger] ?? null }));

  const T: Record<string, number> = {};
  for (const r of pl) if (r.bucket) T[r.bucket] = (T[r.bucket] ?? 0) + signed(r);
  const t = (k: string) => T[k] ?? 0;

  // ---- business profit and loss
  const revenue = t("BUS_REV");
  const otherIncome = t("BUS_OTHINC") + t("HP") + t("OS_ROYALTY");
  const totalIncome = revenue + otherIncome;
  const cogs = -t("BUS_COGS"), employee = -t("BUS_EMP"), finance = -t("BUS_FIN");
  const depreciation = -t("BUS_DEP");
  const otherExpenses = -t("BUS_OTHEXP") + -t("HP_TAX") + inputs.auditFeeProvision;
  const totalExpenses = cogs + employee + finance + depreciation + otherExpenses;
  const profit = totalIncome - totalExpenses;

  // ---- business balance sheet
  const sumBs = (bucket: BsBucket) =>
    bs.filter((r) => r.bucket === bucket).reduce((a, r) => a + bsAmount(r), 0);
  const bizAssetBuckets: BsBucket[] = ["BIZ_PPE", "BIZ_RECV", "BIZ_CASH", "BIZ_OCA"];
  const bizLiabBuckets: BsBucket[] = ["BIZ_PAY", "BIZ_OCL"];
  const assets = bizAssetBuckets.map((k) => ({
    label: BS_BUCKETS.find((b) => b.key === k)!.label, amount: sumBs(k),
  }));
  const liabilities = [
    ...bizLiabBuckets.map((k) => ({ label: BS_BUCKETS.find((b) => b.key === k)!.label, amount: sumBs(k) })),
    ...(inputs.auditFeeProvision ? [{ label: "Audit fees payable (provision)", amount: inputs.auditFeeProvision }] : []),
  ];
  const totalAssets = assets.reduce((a, x) => a + x.amount, 0);
  const totalLiabilities = liabilities.reduce((a, x) => a + x.amount, 0);
  const closingCapital = totalAssets - totalLiabilities;
  // Drawings is what has to have gone out for the capital account to close.
  const drawings = inputs.openingCapital + inputs.capitalIntroduced + profit - closingCapital;

  // ---- house property
  // The books usually hold only his share of a co-owned property, so the annual
  // value is grossed back up, municipal tax comes off the whole, and the share
  // is taken after that — which is the order s.23 and s.24 require.
  const houseProperty = pl
    .filter((r) => r.bucket === "HP")
    .map((r) => {
      const share = inputs.hpOwnershipShare[r.ledger] ?? 100;
      const annualValue = inputs.hpGrossUp[r.ledger] || (share === 100 ? r.amount : (r.amount * 100) / share);
      const municipalTax = inputs.hpMunicipalTax[r.ledger] ?? 0;
      const netAfterShare = ((annualValue - municipalTax) * share) / 100;
      const standardDeduction = netAfterShare * 0.30;
      return {
        property: r.ledger, annualValue, municipalTax, share,
        netAfterShare, standardDeduction, income: netAfterShare - standardDeduction,
      };
    });
  const housePropertyTotal = houseProperty.reduce((a, x) => a + x.income, 0);

  // ---- business income for tax
  const businessIncome =
    profit + depreciation + -t("HP_TAX") - t("HP") - t("OS_ROYALTY") - inputs.depreciationPerItChart;

  // ---- capital gains
  const cgGross = t("CG");
  const setOff = Math.min(Math.max(cgGross, 0), inputs.broughtForwardStcl);
  const capitalGains = {
    gross: cgGross, setOff,
    taxable: Math.max(0, cgGross - setOff),
    carriedForward: Math.max(0, inputs.broughtForwardStcl - setOff) + Math.max(0, -cgGross),
  };

  // ---- other sources
  const osKeys: PlBucket[] = ["OS_INT_SB", "OS_INT_FD", "OS_INT_BOND", "OS_INT_SGB", "OS_INT_OTHER", "OS_DIV", "OS_ROYALTY", "OS_OTHER"];
  const otherSources = osKeys.map((k) => ({ label: PL_BUCKETS.find((b) => b.key === k)!.label, amount: t(k) }))
    .filter((x) => x.amount !== 0);
  const otherSourcesTotal = otherSources.reduce((a, x) => a + x.amount, 0);

  const grossTotalIncome = housePropertyTotal + businessIncome + capitalGains.taxable + otherSourcesTotal;
  const ti = Math.round(grossTotalIncome / 10) * 10;
  const tax = taxNewRegime(ti);
  const surcharge = tax * surchargeRate(ti);
  const cess = (tax + surcharge) * 0.04;

  // ---- Schedule AL
  const alKeys: BsBucket[] = ["AL_IMMOV", "AL_JEWEL", "AL_VEHICLE", "AL_BANK", "AL_SHARES", "AL_LOANS", "AL_CASH", "AL_LIAB"];
  const scheduleAl = alKeys.map((k) => {
    const rows = bs.filter((r) => r.bucket === k && Math.abs(bsAmount(r)) >= 0.5).map((r) => {
      const fc = inputs.usdBalances[r.ledger];
      const restate = typeof fc === "number" && inputs.closingUsdRate > 0;
      return {
        ledger: r.ledger,
        amount: round(restate ? fc * inputs.closingUsdRate : bsAmount(r)),
        restated: restate, foreign: restate ? fc : null,
      };
    });
    return {
      category: BS_BUCKETS.find((b) => b.key === k)!.label,
      rows, total: round(rows.reduce((a, r) => a + r.amount, 0)),
    };
  }).filter((c) => c.rows.length > 0);

  return {
    fy, from, to, pl, bs,
    unmappedPl: pl.filter((r) => !r.bucket && Math.abs(r.amount) >= 0.5).map((r) => r.ledger),
    unmappedBs: bs.filter((r) => !r.bucket && Math.abs(r.amount) >= 0.5).map((r) => r.ledger),
    totals: T,
    business: {
      revenue, otherIncome, totalIncome, cogs, employee, finance, depreciation,
      otherExpenses, totalExpenses, profit,
      assets, liabilities, totalAssets, totalLiabilities, closingCapital, drawings,
    },
    computation: {
      houseProperty, housePropertyTotal, businessIncome,
      speculation: t("SPEC"), capitalGains, otherSources, otherSourcesTotal,
      grossTotalIncome, totalIncome: ti,
      tax, surcharge, cess, totalTax: tax + surcharge + cess,
    },
    scheduleAl,
    builtAt: new Date().toISOString(),
  };
}

export async function buildReturn(fy: string): Promise<ReturnPack> {
  const { from, to } = fyDates(fy);
  const [{ plRows, bsRows }, map, year] = await Promise.all([
    fetchZohoLedgers(from, to), loadMap(), loadYear(fy),
  ]);
  return buildPack({ fy, from, to, plRows, bsRows, map, inputs: year.inputs });
}

// THE SUGGESTED MAPPING, as reconciled against the accountant's own FY 2025-26
// statements on 29 August 2026 — every ledger he used, put where he put it,
// except where the audit found he had put it nowhere at all. It lives in code
// so a fresh database is never empty and so "restore the suggested mapping"
// always has something to restore to. The table overrides it the moment
// anybody changes a row on the page.
export const DEFAULT_PL_MAP: Record<string, PlBucket> = {
  "Sales - Aldine CA": "BUS_REV",
  "Sales - CA Aarish Khan": "BUS_REV",
  "Sales - CA Parveen Sharma": "BUS_REV",
  "Sales-Aarish Khan": "BUS_REV",
  "Sales-Aditya Jain": "BUS_REV",
  "Sales-Amit Chawla": "BUS_REV",
  "Sales-Amit Popli": "BUS_REV",
  "Sales-Ashish Kalra": "BUS_REV",
  "Sales-Ekatvam": "BUS_REV",
  "Sales-Madan Gopal": "BUS_REV",
  "Sales-Pankaj Garg": "BUS_REV",
  "Sales-Parveen Sharma": "BUS_REV",
  "Sales-Raj Kumar": "BUS_REV",
  "Sales-Rajat Jain": "BUS_REV",
  "Sales-Sanjay Saraf": "BUS_REV",
  "Sales-Siddhant Sonthalia": "BUS_REV",
  "Sales-Vaibhav Jalan": "BUS_REV",
  "Sales-Validity": "BUS_REV",
  "Option- NET Inomce-Operating": "BUS_OTHINC",
  "Short & Excess": "BUS_OTHINC",
  "Cash Back": "BUS_OTHINC",
  "Interest From Robinhood": "BUS_OTHINC",
  "Interest-Fidelity Brokerage": "BUS_OTHINC",
  "Cost of Goods Sold": "BUS_COGS",
  "Cost of Goods Sold - Aaditya Jain": "BUS_COGS",
  "Cost of Goods Sold - Aarish Khan": "BUS_COGS",
  "Cost of Goods Sold - Amit Chawla": "BUS_COGS",
  "Cost of Goods Sold - Ashish Kalra": "BUS_COGS",
  "Cost of Goods Sold - CA RAJKUMAR": "BUS_COGS",
  "Cost of Goods Sold - Pankaj Garg": "BUS_COGS",
  "Cost of Goods Sold - Sanjay Saraf": "BUS_COGS",
  "Cost of Goods Sold - Siddhant Sonthalia": "BUS_COGS",
  "Salaries and Employee Wages": "BUS_EMP",
  "Staff Welfare Expenses": "BUS_EMP",
  "Bank Fees and Charges": "BUS_FIN",
  "Depreciation Expense": "BUS_DEP",
  "Business Promotion Expenses": "BUS_OTHEXP",
  "Convenyance Expenses": "BUS_OTHEXP",
  "Courier Expenses": "BUS_OTHEXP",
  "Electricity Expenses": "BUS_OTHEXP",
  "Festival Expenses": "BUS_OTHEXP",
  "IT and Internet Expenses": "BUS_OTHEXP",
  "Meals and Entertainment": "BUS_OTHEXP",
  "MemberShip Fee-ICAI": "BUS_OTHEXP",
  "Office Expenses": "BUS_OTHEXP",
  "Office Supplies": "BUS_OTHEXP",
  "Other Expenses": "BUS_OTHEXP",
  "Postage": "BUS_OTHEXP",
  "Printing and Stationery": "BUS_OTHEXP",
  "Professional Expense": "BUS_OTHEXP",
  "Rent Expense": "BUS_OTHEXP",
  "Security Guard": "BUS_OTHEXP",
  "Software Renewal Expense": "BUS_OTHEXP",
  "Studio Expenses": "BUS_OTHEXP",
  "Telephone Expense": "BUS_OTHEXP",
  "Web Maintainence Expenses": "BUS_OTHEXP",
  "Zoho Software Expenses": "BUS_OTHEXP",
  "Travel Expense": "BUS_OTHEXP",
  "Insurance-Vehicle": "BUS_OTHEXP",
  "ICAi-Fee": "BUS_OTHEXP",
  "Interest to Robinhood": "BUS_OTHEXP",
  "Interest Paid-Fidelity": "BUS_OTHEXP",
  "House or Prperty Tax-Operating": "HP_TAX",
  "Rent from Residential Properties": "HP",
  "Rent-G9-RRM": "HP",
  "Interest on Saving Account -2368": "OS_INT_SB",
  "Interest-SBI Saving Account": "OS_INT_SB",
  "Interest on NRE Account-4597": "OS_INT_SB",
  "Interest from NRO FD-4196": "OS_INT_FD",
  "Interest on NRO FD-2024": "OS_INT_FD",
  "Interest on NRO FD-4204": "OS_INT_FD",
  "Interest on NRO FD-6691": "OS_INT_FD",
  "Interest on NRO FD-7899": "OS_INT_FD",
  "Interest on NRO FD-8087": "OS_INT_FD",
  "Interest on NRO FD-9519": "OS_INT_FD",
  "Interest on RBI Bond": "OS_INT_BOND",
  "INTEREST FROM SOVEREIGN GOLD BONDS": "OS_INT_SGB",
  "Interest on US Tax Refund": "OS_INT_OTHER",
  "Interest-From DATCU": "OS_INT_OTHER",
  "Interest-IBKR": "OS_INT_OTHER",
  "Interest-Think or Swim": "OS_INT_OTHER",
  "Interest From Bank of America Saving Accounts": "OS_INT_OTHER",
  "Dividend-Fidelity": "OS_DIV",
  "Dividend-IBKR": "OS_DIV",
  "Dividend-Tasty Trade": "OS_DIV",
  "Dividend-Think or Swim": "OS_DIV",
  "Dividend-US": "OS_DIV",
  "Royalty Income": "OS_ROYALTY",
  "Income from US Firm INvestment": "OS_OTHER",
  "Income from You Tube": "OS_OTHER",
  "Speculation Profit-US": "SPEC",
  "Speculation Loss-US Market": "SPEC",
  "Profit on Sale of Shares": "CG",
  "Profit on Sale of Shares-Fidelity": "CG",
  "Profit on Sale of Shares-IBKR": "CG",
  "Profit on Sale of Shares-Tasty Trade": "CG",
  "Profit on Sale of Shares-Thinkorswim": "CG",
  "Profit from sale of US Treasury BOND": "CG",
  "Foreign Exchange Difference": "CG",
  "Electric Supplies": "PERSONAL",
  "Gas Supplies": "PERSONAL",
  "Gift to Smridhi": "PERSONAL",
  "Groceries": "PERSONAL",
  "Home Care": "PERSONAL",
  "Home Insurance": "PERSONAL",
  "House Maintenance": "PERSONAL",
  "Legal Expenses": "PERSONAL",
  "Rounding Off": "PERSONAL",
  "Travel cost": "PERSONAL",
  "US Bank Charges": "PERSONAL",
  "US House Tax": "PERSONAL",
  "US Tax Expenses": "PERSONAL",
};

export const DEFAULT_BS_MAP: Record<string, BsBucket> = {
  "Studio Equipment": "BIZ_PPE",
  "Accounts Receivable": "BIZ_RECV",
  "Razorpay Clearing": "BIZ_RECV",
  "Axis Current-923020019087117": "BIZ_CASH",
  "Cash In Hand": "BIZ_CASH",
  "Petty Cash": "BIZ_CASH",
  "Advance Tax A.Y 2026-27": "BIZ_OCA",
  "TDS Receivables AY 26-27": "BIZ_OCA",
  "TCS": "BIZ_OCA",
  "Input CGST": "BIZ_OCA",
  "Input IGST": "BIZ_OCA",
  "Input SGST": "BIZ_OCA",
  "Pradeep": "BIZ_OCA",
  "Shripal": "BIZ_OCA",
  "SD-CCD": "BIZ_OCA",
  "Accounts Payable": "BIZ_PAY",
  "Output CGST": "BIZ_OCL",
  "Output IGST": "BIZ_OCL",
  "Output SGST": "BIZ_OCL",
  "TDS Payable": "BIZ_OCL",
  "Credit Card Axis-4812": "BIZ_OCL",
  "Credit Card- Axis 2500/9682": "BIZ_OCL",
  "Security Deposit-Bikanerwala": "BIZ_OCL",
  "Security Deposit-Rohit Bhargav": "BIZ_OCL",
  "Customer-Imprest Payable": "BIZ_OCL",
  "Drawings": "EQUITY",
  "Owner's Equity": "EQUITY",
  "Retained Earnings": "EQUITY",
  "Bank of America Checking 228": "AL_BANK",
  "Bank of America Savings 244": "AL_BANK",
  "DATCU-Checking-Share 20": "AL_BANK",
  "DATCU-Saving-Share-01": "AL_BANK",
  "Fidelity Brokerage": "AL_BANK",
  "IBKR-Brokerage": "AL_BANK",
  "Robinhood-Brokerage": "AL_BANK",
  "Tasty Trade INC": "AL_BANK",
  "ThinkorSwim": "AL_BANK",
  "NRE_922010055104597": "AL_BANK",
  "NRO-911010041352368": "AL_BANK",
  "SBI Saving": "AL_BANK",
  "8904-Ballinger Drive-Self Occupied": "AL_IMMOV",
  "D-21-102 Gurugram-Self Occupied": "AL_IMMOV",
  "G-9 RRM": "AL_IMMOV",
  "Prop No 66 Sector": "AL_IMMOV",
  "Prop No 67 Sector": "AL_IMMOV",
  "Vacant Plot A-113-102 Gurugram": "AL_IMMOV",
  "Investment in AVPL": "AL_SHARES",
  "Investment in RBI Bond": "AL_SHARES",
  "Investment in Sovereign Gold Bond": "AL_SHARES",
  "Investment in SVPL": "AL_SHARES",
  "Managed Fund": "AL_SHARES",
  "ORCL-IBKR": "AL_SHARES",
  "Traditional IRA": "AL_SHARES",
  "VOO": "AL_SHARES",
  "VOO-Fidelity": "AL_SHARES",
  "VOO-IBKR": "AL_SHARES",
  "Loan From Ruchi Sharma": "AL_LOANS",
  "Madan": "AL_LOANS",
  "Accrued Interest": "AL_LOANS",
  "Security Deposit-DHBVN-Gurugram": "AL_LOANS",
  "US Estimated Tax-2025": "AL_LOANS",
  "Jwellery": "AL_JEWEL",
  "Vehicle-CAR-4561": "AL_VEHICLE",
  "US CAR Loan": "AL_LIAB",
  "Credit Card Robinhood": "AL_LIAB",
  "Credit Card Citi Costco 8145": "AL_LIAB",
  "Credit Card American Exp 1-91006": "AL_LIAB",
  "Credit Card BoFA 7858": "AL_LIAB",
  "Credit Card DATCU-7935": "AL_LIAB",
  "NRO FD-92404008604204": "AL_BANK",
  "NRO FD-925040061267899": "AL_BANK",
  "NRO FD-925040061268087": "AL_BANK",
  "NRO FD-926040057146691": "AL_BANK",
  "NRO FD-926040057149519": "AL_BANK",
  "NRO FD-926040060924196": "AL_BANK",
  "NRO FD-926040067192024": "AL_BANK",
};

