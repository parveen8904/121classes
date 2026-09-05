// THE 1040, BUILT FROM THE STATUTE RATHER THAN TYPED IN.
//
// "i want my us 1040 page" — 5 September 2026, against his own
// Computation-PSRS US TAX workbook. Everything below is the arithmetic that
// workbook performs; nothing here is guessed, and every figure it cannot
// derive is an input he sets, listed in INPUT_KEYS.
//
// Deliberately pure: no database, no Zoho, no dates. The tax on $1,375,389 of
// taxable income is a fact about the law, and a fact about the law should be
// provable in a test without a connection to anything.

export type Bracket = { from: number; to: number | null; rate: number };

/** Married filing jointly, 2025 — Rev. Proc. 2024-40, as his workbook cites. */
export const BRACKETS_2025_MFJ: Bracket[] = [
  { from: 0, to: 23850, rate: 0.10 },
  { from: 23850, to: 96950, rate: 0.12 },
  { from: 96950, to: 206700, rate: 0.22 },
  { from: 206700, to: 394600, rate: 0.24 },
  { from: 394600, to: 501050, rate: 0.32 },
  { from: 501050, to: 751600, rate: 0.35 },
  { from: 751600, to: null, rate: 0.37 },
];

export type Band = { label: string; from: number; to: number | null; rate: number; inBand: number; tax: number };

/** The slab tax on ordinary income, band by band, so the working is visible. */
export function bandedTax(ordinary: number, brackets: Bracket[]): { bands: Band[]; total: number } {
  const bands: Band[] = [];
  let total = 0;
  for (const b of brackets) {
    const ceiling = b.to ?? Infinity;
    const inBand = Math.max(0, Math.min(ordinary, ceiling) - b.from);
    const tax = inBand * b.rate;
    bands.push({ label: `${Math.round(b.rate * 100)}%`, from: b.from, to: b.to, rate: b.rate, inBand, tax });
    total += tax;
  }
  return { bands, total };
}

export type Us1040Figures = {
  /** Income, in dollars. The first four come from the books plus the 1099s. */
  interest: number; dividends: number; businessIncome: number;
  capitalGain: number; rentsRoyalties: number; rentalDepreciation: number;
  /** Adjustments and deductions. */
  traditionalIra: number; standardDeduction: number; qbiDeduction: number;
  /** Rates and thresholds — statute for the year. */
  qualifiedDividends: number; qualifiedDividendRate: number;
  socialSecurityWageBase: number; additionalMedicareThreshold: number;
  /** Credits and the other taxes. */
  foreignTaxCredit: number; netInvestmentIncomeTax: number;
  /** Payments. */
  estimatedTaxPaid: number; creditAppliedFromPriorYear: number; balancePayment: number;
};

export type Us1040 = {
  totalIncome: number;
  selfEmploymentTax: number; deductibleHalfOfSeTax: number;
  adjustedGrossIncome: number; taxableIncome: number;
  ordinaryIncome: number; bands: Band[];
  taxOnOrdinary: number; taxOnQualifiedDividends: number; tax: number;
  taxAfterCredit: number;
  additionalMedicare: number;
  totalTax: number; totalPayments: number; balance: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function compute1040(f: Us1040Figures, brackets = BRACKETS_2025_MFJ): Us1040 {
  const totalIncome =
    f.interest + f.dividends + f.businessIncome + f.capitalGain + f.rentsRoyalties + f.rentalDepreciation;

  // SELF-EMPLOYMENT TAX — s.1402(a)(12) and s.1401.
  //
  // Net earnings are reduced to 92.35% BEFORE the tax applies: the
  // employer-equivalent half is not itself earnings. Social security stops at
  // the wage base; Medicare does not stop at all. Half the result comes off
  // income, which is why it is computed before AGI and not after.
  const netEarnings = Math.max(0, f.businessIncome) * 0.9235;
  const socialSecurity = Math.min(netEarnings, f.socialSecurityWageBase) * 0.124;
  const medicare = netEarnings * 0.029;
  const selfEmploymentTax = socialSecurity + medicare;
  const deductibleHalfOfSeTax = selfEmploymentTax / 2;

  const adjustedGrossIncome = totalIncome - deductibleHalfOfSeTax + f.traditionalIra;
  const taxableIncome = adjustedGrossIncome + f.standardDeduction + f.qbiDeduction;

  // Qualified dividends are taxed at their own rate, so they come OUT of the
  // slab base rather than being taxed twice.
  const ordinaryIncome = Math.max(0, taxableIncome - f.qualifiedDividends);
  const { bands, total: taxOnOrdinary } = bandedTax(ordinaryIncome, brackets);
  const taxOnQualifiedDividends = f.qualifiedDividends * f.qualifiedDividendRate;
  const tax = taxOnOrdinary + taxOnQualifiedDividends;

  // THE CREDIT CANNOT REACH PAST THE TAX IT OFFSETS.
  // A foreign tax credit bigger than the tax does not make a refund; it is
  // limited, and the rest is carried. Letting it go negative here would
  // understate what is owed.
  const taxAfterCredit = Math.max(0, tax - Math.abs(f.foreignTaxCredit));

  const additionalMedicare =
    Math.max(0, netEarnings - f.additionalMedicareThreshold) * 0.009;

  const totalTax = taxAfterCredit + selfEmploymentTax + additionalMedicare + f.netInvestmentIncomeTax;
  const totalPayments = f.estimatedTaxPaid + f.creditAppliedFromPriorYear + f.balancePayment;

  return {
    totalIncome: r2(totalIncome),
    selfEmploymentTax: r2(selfEmploymentTax),
    deductibleHalfOfSeTax: r2(deductibleHalfOfSeTax),
    adjustedGrossIncome: r2(adjustedGrossIncome),
    taxableIncome: r2(taxableIncome),
    ordinaryIncome: r2(ordinaryIncome),
    bands,
    taxOnOrdinary: r2(taxOnOrdinary),
    taxOnQualifiedDividends: r2(taxOnQualifiedDividends),
    tax: r2(tax),
    taxAfterCredit: r2(taxAfterCredit),
    additionalMedicare: r2(additionalMedicare),
    totalTax: r2(totalTax),
    totalPayments: r2(totalPayments),
    balance: r2(totalPayments - totalTax),
  };
}

/** Every figure he sets, with where it comes from — the workbook's Inputs sheet. */
export const INPUT_KEYS: { key: keyof Us1040Figures; label: string; source: string; statutory?: boolean }[] = [
  { key: "interest", label: "Taxable interest — line 2b", source: "the books, plus any 1099-INT" },
  { key: "dividends", label: "Ordinary dividends — line 3b", source: "the books, plus any 1099-DIV" },
  { key: "businessIncome", label: "Business income — Schedule C line 8a", source: "the books" },
  { key: "capitalGain", label: "Capital gain — Schedule D line 7", source: "the 1099-Bs, NOT the rupee scrip ledgers" },
  { key: "rentsRoyalties", label: "Rents and royalties — Schedule E line 8", source: "the books" },
  { key: "rentalDepreciation", label: "Less: rental depreciation", source: "the depreciation schedule (a negative)" },
  { key: "traditionalIra", label: "Traditional IRA", source: "Form 5498 (a negative)" },
  { key: "standardDeduction", label: "Standard deduction — line 12", source: "statute (a negative)", statutory: true },
  { key: "qbiDeduction", label: "Qualified business income — line 13", source: "s.199A needs a US trade or business", statutory: true },
  { key: "qualifiedDividends", label: "Qualified dividends — line 3a", source: "the 1099-DIVs" },
  { key: "qualifiedDividendRate", label: "Qualified dividend rate", source: "statute", statutory: true },
  { key: "socialSecurityWageBase", label: "Social security wage base", source: "statute", statutory: true },
  { key: "additionalMedicareThreshold", label: "Additional Medicare threshold", source: "statute", statutory: true },
  { key: "foreignTaxCredit", label: "Foreign tax credit — Schedule 3 line 1", source: "Form 1116" },
  { key: "netInvestmentIncomeTax", label: "Net investment income tax — Form 8960", source: "3.8% on investment income" },
  { key: "estimatedTaxPaid", label: "Estimated tax paid", source: "the account transcript" },
  { key: "creditAppliedFromPriorYear", label: "Credit applied from the prior year", source: "transaction code 716" },
  { key: "balancePayment", label: "Balance payment", source: "what you have since paid" },
];

/** 2025 statute, so a fresh year opens with the law rather than with zeros. */
export const STATUTORY_2025: Partial<Us1040Figures> = {
  standardDeduction: -31500,
  qbiDeduction: 0,
  qualifiedDividendRate: 0.20,
  socialSecurityWageBase: 176100,
  additionalMedicareThreshold: 250000,
};
