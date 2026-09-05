// EVERY YEAR ON ITS OWN LAW.
//
// "2026 us tax 1040 not working, similarly 2024 not working" — 5 September
// 2026. Nothing threw: the page computed 2024 and 2026 on the 2025 brackets and
// the 2025 deduction, because those were the only ones written down. A return
// on the wrong year's law is not an error message, it is a wrong number that
// looks exactly like a right one, so each year is pinned here to its own
// Revenue Procedure.
import { STATUTE_BY_YEAR, statuteFor, statutoryFigures, compute1040, type Us1040Figures } from "../lib/us1040.ts";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};

/* ── the figures, off each year's own source ─────────────────────────────── */

const starts = (year: number) => STATUTE_BY_YEAR[year].brackets.map((b) => b.from);

check("2023 — Rev. Proc. 2022-38",
  String(starts(2023)) === String([0, 22000, 89450, 190750, 364200, 462500, 693750])
    && STATUTE_BY_YEAR[2023].standardDeduction === -27700
    && STATUTE_BY_YEAR[2023].socialSecurityWageBase === 160200);

check("2024 — Rev. Proc. 2023-34",
  String(starts(2024)) === String([0, 23200, 94300, 201050, 383900, 487450, 731200])
    && STATUTE_BY_YEAR[2024].standardDeduction === -29200
    && STATUTE_BY_YEAR[2024].socialSecurityWageBase === 168600);

check("2025 — Rev. Proc. 2024-40, deduction as raised by the July 2025 Act",
  String(starts(2025)) === String([0, 23850, 96950, 206700, 394600, 501050, 751600])
    && STATUTE_BY_YEAR[2025].standardDeduction === -31500
    && STATUTE_BY_YEAR[2025].socialSecurityWageBase === 176100,
  "31,500 and not the 30,000 of the Rev. Proc. — that is what was filed");

check("2026 — Rev. Proc. 2025-32",
  String(starts(2026)) === String([0, 24800, 100800, 211400, 403550, 512450, 768700])
    && STATUTE_BY_YEAR[2026].standardDeduction === -32200
    && STATUTE_BY_YEAR[2026].socialSecurityWageBase === 184500);

/* ── the shape every year must hold ──────────────────────────────────────── */

for (const y of Object.keys(STATUTE_BY_YEAR).map(Number)) {
  const st = STATUTE_BY_YEAR[y];
  check(`${y} has seven bands at the statutory rates`,
    String(st.brackets.map((b) => b.rate)) === String([0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]));
  check(`${y}'s bands are contiguous and the top has no ceiling`,
    st.brackets.every((b, i) => i === 0 ? b.from === 0 : b.from === st.brackets[i - 1].to)
      && st.brackets[6].to === null);
  check(`${y}'s standard deduction is held as a negative`, st.standardDeduction < 0,
    "it comes off income, and a positive would add to it");
  check(`${y} cites its source`, /Rev\. Proc\. \d{4}-\d+/.test(st.citation));
  check(`${y}'s additional Medicare threshold is the unindexed 250,000`,
    st.additionalMedicareThreshold === 250000, "s.1401(b)(2)(A) — a joint return, never indexed");
}

/* ── the years actually differ, which is the whole point ─────────────────── */

const income: Us1040Figures = {
  interest: 0, dividends: 0, businessIncome: 200000, capitalGain: 0,
  rentsRoyalties: 0, rentalDepreciation: 0, traditionalIra: 0,
  qualifiedDividends: 0, generalGrossForeign: 0, generalForeignTax: 0,
  passiveGrossForeign: 0, passiveForeignTax: 0, netInvestmentIncomeTax: 0,
  estimatedTaxPaid: 0, creditAppliedFromPriorYear: 0, balancePayment: 0,
  ...(statutoryFigures(2024) as Partial<Us1040Figures>),
} as Us1040Figures;

const on = (y: number) => compute1040(
  { ...income, ...(statutoryFigures(y) as Partial<Us1040Figures>) },
  STATUTE_BY_YEAR[y].brackets,
);
check("the same income taxes differently in each year",
  new Set([2023, 2024, 2025, 2026].map((y) => on(y).totalTax)).size === 4,
  "if two years agree to the cent, one of them is borrowing the other's law");
check("a later year's income tax on the same income is lower, the bands having widened",
  on(2026).tax < on(2025).tax && on(2025).tax < on(2024).tax && on(2024).tax < on(2023).tax);
check("…while the self-employment tax rises, the wage base having risen",
  on(2026).selfEmploymentTax > on(2025).selfEmploymentTax
    && on(2025).selfEmploymentTax > on(2024).selfEmploymentTax,
  "the two move opposite ways, which is why total tax is not a monotone test");

/* ── a year with no statute is refused, never approximated ───────────────── */

check("an unheld year has no statute", statuteFor(2019) === null && statutoryFigures(2019) === null,
  "borrowing the nearest year is the one thing this must never do");

import { readFileSync } from "node:fs";
const page = readFileSync("app/admin/zoho/tax/us1040/page.tsx", "utf8");
const actions = readFileSync("app/admin/zoho/tax/us1040/actions.ts", "utf8");
const route = readFileSync("app/admin/zoho/tax/us/route.ts", "utf8");

check("the page computes on the year's brackets, not on 2025's",
  /compute1040\(f, statute\?\.brackets/.test(page) && !/BRACKETS_2025_MFJ/.test(page),
  "the default argument is 2025, which is right once a year and wrong the rest");
check("the page falls back to the year's statute, not to zero",
  /held\.get\(k\.key\) \?\? \(lawful as Record<string, number>\)\[k\.key\]/.test(page),
  "2026 showed a wage base of $0.00 because nothing had been seeded");
check("a year with no statute shows nothing rather than a wrong return",
  /does not hold the statute for \{year\}/.test(page) && /\{statute && \(<>/.test(page));
check("the band table names the year it actually used",
  /\{year\} married-filing-jointly bands, \{statute\?\.citation\}/.test(page),
  "the caption said 2025 on every year's page");
check("seeding writes THAT year's statute",
  /statutoryFigures\(year\)/.test(actions) && !/STATUTORY_2025/.test(actions),
  '"copied from 2025 — CHECK against this year\'s Rev. Proc." is a note nobody reads');
check("the exported file uses the year's brackets too",
  /compute1040\(f, statute\.brackets\)/.test(route),
  "the Excel had the same fault as the page");

console.log(fails ? `${fails} failed` : "ok — every year computes on its own statute");
process.exit(fails ? 1 : 0);
