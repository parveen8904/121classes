// Form 1116 must reproduce his own 2025 sheet, basket by basket.
import { computeForm1116 } from "../lib/form1116.ts";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// Read off the Form 1116 sheet of Computation-PSRS US TAX.xlsx, 2025.
const r = computeForm1116({
  general: { grossForeign: 410981.10999999969, foreignTaxPaid: 157986.73890858109, definitelyRelated: -16421.772941482497 },
  passive: { grossForeign: 698634.69524433033, foreignTaxPaid: 275717.43523907143, definitelyRelated: 0 },
  grossIncomeAllSources: 1431310.9152443302,
  standardDeduction: 31500,
  traditionalIra: 8000,
  totalTaxableIncome: 1375389.1423028477,
  taxBeforeCredits: 432187.2819520536,
});
const [gen, pas] = r.baskets;

check("the standard deduction is shared on GROSS income from all sources",
  near(gen.standardDeductionShare, -9044.79, 0.02) && near(pas.standardDeductionShare, -15375.41, 0.02),
  "not on the foreign total — line 3a apportions across the whole return");
check("the IRA is shared the same way",
  near(gen.iraShare, -2297.09, 0.02) && near(pas.iraShare, -3904.87, 0.02));
check("the self-employment half hits the GENERAL basket only",
  gen.definitelyRelated !== 0 && pas.definitelyRelated === 0,
  "it is definitely related to the practice and to nothing else");

check("general foreign-source taxable income — line 17",
  near(gen.foreignTaxableIncome, 383217.46), `got ${gen.foreignTaxableIncome}, his 383,217.46`);
check("passive foreign-source taxable income — line 17",
  near(pas.foreignTaxableIncome, 679354.42), `got ${pas.foreignTaxableIncome}, his 679,354.42`);

check("the general limit — line 21", near(gen.limit, 120418.07), `got ${gen.limit}, his 120,418.07`);
check("the passive limit — line 21", near(pas.limit, 213472.92), `got ${pas.limit}, his 213,472.92`);

check("credit allowed is the LESSER of the limit and the tax paid",
  near(gen.creditAllowed, 120418.07) && near(pas.creditAllowed, 213472.92));
check("TOTAL CREDIT — Schedule 3 line 1", near(r.totalCredit, 333890.997),
  `got ${r.totalCredit}, his 333,890.997 — the figure on the 1040`);
check("carried forward, per basket — s.904(c)",
  near(gen.carriedForward, 37568.66) && near(pas.carriedForward, 62244.51));
check("TOTAL CARRIED", near(r.totalCarried, 99813.18), `got ${r.totalCarried}, his 99,813.18`);

/* ── the rules that stop it being generous ───────────────────────────────── */

check("a basket with room to spare credits only the tax actually paid", (() => {
  const x = computeForm1116({
    general: { grossForeign: 100000, foreignTaxPaid: 500, definitelyRelated: 0 },
    passive: { grossForeign: 0, foreignTaxPaid: 0, definitelyRelated: 0 },
    grossIncomeAllSources: 100000, standardDeduction: 0, traditionalIra: 0,
    totalTaxableIncome: 100000, taxBeforeCredits: 30000,
  });
  return x.baskets[0].creditAllowed === 500 && x.baskets[0].carriedForward === 0;
})(), "the credit is never more than the foreign tax paid");

check("the baskets are never pooled — s.904(d)", (() => {
  const x = computeForm1116({
    general: { grossForeign: 100000, foreignTaxPaid: 90000, definitelyRelated: 0 },
    passive: { grossForeign: 100000, foreignTaxPaid: 100, definitelyRelated: 0 },
    grossIncomeAllSources: 200000, standardDeduction: 0, traditionalIra: 0,
    totalTaxableIncome: 200000, taxBeforeCredits: 40000,
  });
  // General is capped at its own 20,000 even though passive leaves 19,900 spare.
  return near(x.baskets[0].creditAllowed, 20000) && x.baskets[0].carriedForward > 0;
})(), "a shortfall in one basket may not borrow room from the other");

check("the s.904(d) rule is said on the output, not just obeyed",
  r.notes.some((n) => /forbids pooling|s\.904\(c\)/.test(n)));

/* ── and it is on the screen and in the file ─────────────────────────────── */

import { readFileSync } from "node:fs";
const page = readFileSync("app/admin/zoho/tax/us1040/page.tsx", "utf8");
const route = readFileSync("app/admin/zoho/tax/us/route.ts", "utf8");
const engine = readFileSync("lib/us1040.ts", "utf8");
const itr = readFileSync("lib/itrReturn.ts", "utf8");

check("the 1040's credit is computed from 1116, never typed",
  /const foreignTaxCredit = f1116\.totalCredit;/.test(engine)
    && !/key: "foreignTaxCredit"/.test(engine),
  "a typed number could put a credit on the return the statute does not permit");
check("the self-employment half is charged to the general basket only",
  /definitelyRelated: -deductibleHalfOfSeTax/.test(engine) && /passive: \{[^}]*definitelyRelated: 0/.test(engine));
check("the baskets are on the page", /the two baskets, the limit, and what is carried/.test(page));
check("…and in the exported file", /FORM 1116 — the two baskets/.test(route));
check("the carry is shown, not swallowed", /Carried/.test(page) && /totalCarried/.test(route));

/* ── the mapping question that came with it ─────────────────────────────── */

check("a new member of a known family is placed by shape",
  /export function familyBucket/.test(itr) && /\/\^NRO FD\[/.test(itr),
  "the map was a dictionary of exact names, so every new FD and card fell through");
check("the families are applied only where the exact name misses",
  /p\.map\.pl\[r\.ledger\] \?\? familyBucket\(r\.ledger, "pl"\)/.test(itr),
  "an override he set must always win");
check("nothing needing judgment is guessed",
  /Prepaid Expenses, Staff Loan Account, Salary Payable, an air/.test(itr),
  "a wrong destination is worse than none — that is what the red list is for");

console.log(fails ? `${fails} failed` : "ok — Form 1116 reproduces his 2025 sheet");
process.exit(fails ? 1 : 0);
