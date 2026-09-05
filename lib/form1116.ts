// FORM 1116 — THE TWO BASKETS, THE LIMIT, AND WHAT IS CARRIED.
//
// "do form 1116 next" — 5 September 2026. Built from his own workbook's sheet
// and checked against it to the cent in tests/form1116.test.ts.
//
// The credit can shelter the US tax on FOREIGN income and not a cent more. The
// ceiling is
//
//     tax before credits  ×  foreign-source taxable income
//                            ───────────────────────────────
//                                total taxable income
//
// and s.904(d) applies it to each BASKET on its own. General — the practice —
// and passive — rent, interest, royalty — are tested separately and may not be
// pooled, so room going spare in one cannot rescue a shortfall in the other.
// In 2025 both bind, and ₹99,813 of Indian tax goes unused into the carry.
//
// Pure on purpose: no database, no Zoho. What the credit comes to on a given
// set of figures is a fact about the statute and should be provable without a
// connection to anything.

export type BasketInput = {
  /** Foreign-source GROSS income in this basket — Form 1116 line 1a. */
  grossForeign: number;
  /** Indian tax attributable to that income — the numerator of the comparison. */
  foreignTaxPaid: number;
  /** Expenses definitely related to this basket — line 2. On the general
   *  basket that is the deductible half of the self-employment tax: it belongs
   *  to the practice and to nothing else. Passive income has none. */
  definitelyRelated: number;
};

export type BasketResult = BasketInput & {
  label: string;
  standardDeductionShare: number;
  iraShare: number;
  foreignTaxableIncome: number;
  limit: number;
  creditAllowed: number;
  carriedForward: number;
};

export type Form1116Input = {
  general: BasketInput;
  passive: BasketInput;
  /** 1040 line 9 — the denominator the deductions are apportioned on. */
  grossIncomeAllSources: number;
  /** Positive figures: what came off income and must be shared out. */
  standardDeduction: number;
  traditionalIra: number;
  /** 1040 line 15 and line 16. */
  totalTaxableIncome: number;
  taxBeforeCredits: number;
};

export type Form1116 = {
  baskets: BasketResult[];
  totalForeignTaxable: number;
  totalLimit: number;
  totalCredit: number;
  totalCarried: number;
  notes: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeForm1116(f: Form1116Input): Form1116 {
  const notes: string[] = [];

  const one = (label: string, b: BasketInput): BasketResult => {
    // APPORTIONED ON GROSS INCOME FROM ALL SOURCES, not on the foreign total.
    // The standard deduction and the IRA are not attributable to any basket, so
    // each takes the share its gross income bears to the whole return — which
    // is what line 3a means and what his workbook does.
    const share = f.grossIncomeAllSources > 0 ? b.grossForeign / f.grossIncomeAllSources : 0;
    const standardDeductionShare = -Math.abs(f.standardDeduction) * share;
    const iraShare = -Math.abs(f.traditionalIra) * share;
    const foreignTaxableIncome = b.grossForeign - Math.abs(b.definitelyRelated) + standardDeductionShare + iraShare;

    const limit = f.totalTaxableIncome > 0
      ? f.taxBeforeCredits * (foreignTaxableIncome / f.totalTaxableIncome)
      : 0;
    // THE LESSER OF THE TWO. A credit is never more than the foreign tax
    // actually paid, and never more than the US tax on that foreign income.
    const creditAllowed = Math.max(0, Math.min(limit, b.foreignTaxPaid));
    const carriedForward = Math.max(0, b.foreignTaxPaid - creditAllowed);

    return {
      ...b, label,
      standardDeductionShare: r2(standardDeductionShare),
      iraShare: r2(iraShare),
      foreignTaxableIncome: r2(foreignTaxableIncome),
      limit: r2(limit),
      creditAllowed: r2(creditAllowed),
      carriedForward: r2(carriedForward),
    };
  };

  const baskets = [one("General — the practice", f.general), one("Passive — rent, interest, royalty", f.passive)];
  const totalCarried = baskets.reduce((a, b) => a + b.carriedForward, 0);

  if (totalCarried > 0) {
    notes.push(
      `${baskets.filter((b) => b.carriedForward > 0).map((b) => b.label.split(" —")[0]).join(" and ")} `
      + `${baskets.filter((b) => b.carriedForward > 0).length === 1 ? "is" : "are"} limited: `
      + `$${r2(totalCarried).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of Indian tax is not creditable this year `
      + "and carries forward ten years in its own basket — s.904(c).",
    );
  }
  // s.904(d) — said out loud, because it is the rule most often assumed away.
  if (baskets.some((b) => b.carriedForward > 0) && baskets.some((b) => b.limit > b.foreignTaxPaid)) {
    notes.push(
      "One basket has room to spare while the other is short. It cannot be lent: s.904(d) tests the "
      + "baskets separately and forbids pooling.",
    );
  }

  return {
    baskets,
    totalForeignTaxable: r2(baskets.reduce((a, b) => a + b.foreignTaxableIncome, 0)),
    totalLimit: r2(baskets.reduce((a, b) => a + b.limit, 0)),
    totalCredit: r2(baskets.reduce((a, b) => a + b.creditAllowed, 0)),
    totalCarried: r2(totalCarried),
    notes,
  };
}
