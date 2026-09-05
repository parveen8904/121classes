// The 1040 must reproduce his own 2025 workbook, line for line.
import { compute1040, bandedTax, BRACKETS_2025_MFJ, STATUTORY_2025, type Us1040Figures } from "../lib/us1040.ts";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// Every figure below is read off Computation-PSRS US TAX.xlsx for 2025.
const f: Us1040Figures = {
  interest: 606390.87,
  dividends: 9850.72,
  businessIncome: 410998.11,
  capitalGain: 310550.06,
  rentsRoyalties: 122827.08,
  rentalDepreciation: -29305.924755669545,
  traditionalIra: -8000,
  qualifiedDividends: 4524.71,
  generalGrossForeign: 410981.10999999969,
  generalForeignTax: 157986.73890858109,
  passiveGrossForeign: 698634.69524433033,
  passiveForeignTax: 275717.43523907143,
  netInvestmentIncomeTax: 38955.55,
  estimatedTaxPaid: 155000,
  creditAppliedFromPriorYear: 1772.88,
  balancePayment: 20000,
  ...STATUTORY_2025,
} as Us1040Figures;

const r = compute1040(f);

check("TOTAL INCOME — line 9", near(r.totalIncome, 1431310.92), `got ${r.totalIncome}, his 1,431,310.92`);
check("self-employment tax — Schedule 2", near(r.selfEmploymentTax, 32843.55), `got ${r.selfEmploymentTax}, his 32,843.55`);
check("deductible half — line 15", near(r.deductibleHalfOfSeTax, 16421.77), `got ${r.deductibleHalfOfSeTax}, his 16,421.77`);
check("ADJUSTED GROSS INCOME — line 11", near(r.adjustedGrossIncome, 1406889.14), `got ${r.adjustedGrossIncome}, his 1,406,889.14`);
check("TAXABLE INCOME — line 15", near(r.taxableIncome, 1375389.14), `got ${r.taxableIncome}, his 1,375,389.14`);
check("ordinary income, taxed at the slabs", near(r.ordinaryIncome, 1370864.43), `got ${r.ordinaryIncome}`);
check("tax on ordinary income", near(r.taxOnOrdinary, 431282.34), `got ${r.taxOnOrdinary}, his 431,282.34`);
check("qualified dividends at 20%", near(r.taxOnQualifiedDividends, 904.94), `got ${r.taxOnQualifiedDividends}`);
check("TAX — line 16", near(r.tax, 432187.28), `got ${r.tax}, his 432,187.28`);
check("the foreign tax credit is COMPUTED from Form 1116, not typed",
  near(r.foreignTaxCredit, 333890.997), `got ${r.foreignTaxCredit}, his 333,890.997`);
check("tax after the foreign tax credit", near(r.taxAfterCredit, 98296.29), `got ${r.taxAfterCredit}, his 98,296.29`);
check("and the carry comes with it",
  near(r.f1116.totalCarried, 99813.18), `got ${r.f1116.totalCarried}, his 99,813.18`);
check("ADDITIONAL MEDICARE — Form 8959", near(r.additionalMedicare, 1166.01), `got ${r.additionalMedicare}, his 1,166.01`);
check("TOTAL TAX — line 24", near(r.totalTax, 171261.39), `got ${r.totalTax}, his 171,261.39`);
check("TOTAL PAYMENTS — line 33", near(r.totalPayments, 176772.88), `got ${r.totalPayments}`);
check("OVERPAID — line 34", near(r.balance, 5511.49), `got ${r.balance}, his 5,511.49`);

/* ── TO THE CENT, not to the dollar ──────────────────────────────────────
 * The checks above allow a dollar, and a dollar was enough room to hide a
 * rounded foreign tax credit: the credit was rounded to cents for display and
 * that rounded figure then carried on through the return, so the amount
 * overpaid came out a cent under his workbook's. "In my excel overpaid is not
 * this amount" — 5 September 2026. Round for the eye, never for the sum. */
const cent = (a: number, b: number) => Math.abs(a - b) < 0.005;
check("the credit that continues the chain is exact, not the rounded one",
  cent(r.foreignTaxCredit, 333890.99675446824), `got ${r.foreignTaxCredit}`);
check("TOTAL TAX agrees to the cent", cent(r.totalTax, 171261.39), `got ${r.totalTax}`);
check("OVERPAID agrees to the cent", cent(r.balance, 5511.49), `got ${r.balance}, his 5,511.49`);

check("taxable income is floored at nil — line 15's \"if zero or less, enter -0-\"", (() => {
  const empty = compute1040({ ...f, interest: 0, dividends: 0, businessIncome: 0,
    capitalGain: 0, rentsRoyalties: 0, rentalDepreciation: 0, qualifiedDividends: 0 });
  return empty.taxableIncome === 0 && empty.tax === 0;
})(), "an empty 2024 showed a taxable income of −$29,200 — the deduction against nothing");

/* ── the bands, as his Tax computation sheet lays them out ───────────────── */

const { bands } = bandedTax(1370864.4323028477, BRACKETS_2025_MFJ);
check("the 10% band is 23,850 at 2,385", near(bands[0].inBand, 23850) && near(bands[0].tax, 2385));
check("the 24% band is 187,900 at 45,096", near(bands[3].inBand, 187900) && near(bands[3].tax, 45096));
check("the top band has no ceiling and takes the rest",
  bands[6].to === null && near(bands[6].inBand, 619264.43) && near(bands[6].tax, 229127.84));
check("the bands sum to the tax on ordinary income",
  near(bands.reduce((a, b) => a + b.tax, 0), 431282.34));

/* ── the rules that stop it being wrong in a way nobody would see ────────── */

check("social security stops at the wage base, Medicare does not", (() => {
  const big = compute1040({ ...f, businessIncome: 2000000 });
  const ne = 2000000 * 0.9235;
  return near(big.selfEmploymentTax, 176100 * 0.124 + ne * 0.029, 2);
})(), "s.1401 caps one and not the other");

check("an enormous foreign tax is capped by the 1116 limit, not by the tax", (() => {
  const over = compute1040({ ...f, generalForeignTax: 9_000_000, passiveForeignTax: 9_000_000 });
  // The ceiling is the US tax on the FOREIGN share of taxable income, so it is
  // below the whole tax whenever any income is US-source — and the rest carries.
  return over.foreignTaxCredit <= over.tax
    && over.taxAfterCredit >= 0
    && over.f1116.totalCarried > 0;
})(), "an unlimited credit would understate what is owed");

check("net earnings are 92.35% of the business income, not 100%", (() => {
  const one = compute1040({ ...f, businessIncome: 100000 });
  return near(one.selfEmploymentTax, 100000 * 0.9235 * (0.124 + 0.029), 2);
})(), "s.1402(a)(12) — the employer-equivalent half is not itself earnings");

check("a loss-making Schedule C owes no self-employment tax",
  compute1040({ ...f, businessIncome: -50000 }).selfEmploymentTax === 0);

/* ── the page exists, and the safe harbour does not ─────────────────────── */

import { readFileSync } from "node:fs";
const page = readFileSync("app/admin/zoho/tax/us1040/page.tsx", "utf8");
const taxPage = readFileSync("app/admin/zoho/tax/page.tsx", "utf8");
const engine = readFileSync("lib/taxEngine.ts", "utf8");

check("there is a 1040 page and the Tax page links to it",
  /Form 1040/.test(page) && /Open Form 1040/.test(taxPage),
  '"i want my us 1040 page. where is that."');
check("every figure he sets is editable on the row",
  /action=\{setUs1040Input\}/.test(page) && /INPUT_KEYS\.map/.test(page),
  "the standing rule: an editor wherever a record is shown");
check("a year with nothing set says so instead of showing a zero return",
  /Nothing is set for \{year\}/.test(page) && /a zero return is not/.test(page));
check("a year with the STATUTE but no income also says so",
  /has the statute but no income/.test(page) && /const seededOnly =/.test(page),
  "seeding wrote rows, and 'has any row' then went quiet over a return of arithmetic on nothing");
check("having income, not having rows, is the test",
  /const hasIncome = incomeKeys\.some/.test(page) && /const started = hasIncome;/.test(page));
check("the bands are shown, so line 16 can be checked by hand",
  /How the tax on line 16 is made/.test(page));
check("the capital-gains trap is on the page, not just in my head",
  /1099-Bs/.test(page) && /rupee scrip/.test(page) && /511,788/.test(page));

check("the US safe harbour is gone from the engine",
  !/export function usEstimatedTax/.test(engine) && !/safeHarbourUsd/.test(engine),
  '"US safe harbor does not applies to me remove it."');
check("…and from the Tax page",
  !/safe harbour/i.test(taxPage) && !/us_py_tax/.test(taxPage));

console.log(fails ? `${fails} failed` : "ok — the 1040 reproduces his 2025 workbook");
process.exit(fails ? 1 : 0);
