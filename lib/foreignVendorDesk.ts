// THE FOREIGN VENDOR DESK — how a bill from outside India is to be handled.
//
// One invoice from Vercel or Bunny raises four separate questions, and getting
// any of them wrong is expensive: what to withhold, which part of Form 145,
// whether an accountant's certificate has to come first, and where the money
// should be paid from. The founder ruled the tax positions; this file holds the
// reasoning that applies them to each invoice, so the accounts desk is asked
// the FACTS and never has to work out the law.
//
// Every rate, threshold and country sits in the CONFIG block below. When the
// law changes, change that block — the reasoning underneath never moves.
//
// Law: Income-tax Act 2025 + Rules 2026, in force 1 April 2026.

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════ */
export const FVD = {
  /** The payer. Settled facts about the founder — never asked again. */
  PAYER: {
    hasTan: true,               // he has a TAN. Do not ask.
    residentStatus: "ROR",      // resident and ordinarily resident
    homeState: "DL",
  },

  THRESHOLDS: {
    /** Paid to ONE vendor in the financial year, above which a chargeable
     *  remittance needs Part B or Part C rather than Part A. */
    FORM_145_AGGREGATE: 500_000,
    /** Amber warning in the register, so a vendor never crosses the line
     *  above unnoticed mid-year. */
    REGISTER_WARNING: 400_000,
  },

  RATES: {
    /** Domestic rate on a payment to a non-resident — s.393(2), Table Sl. 17. */
    NO_TREATY: 20,
    /** Cess, charged on the tax. Applies to the domestic rate only; a treaty
     *  rate is a ceiling and is not grossed up by cess. */
    CESS: 4,
    /** Surcharge on the domestic rate, by the payee's Indian receipts. */
    SURCHARGE: [{ above: 10_000_000, pct: 15 }, { above: 5_000_000, pct: 10 }],
  },

  /** makeAvailable — does the treaty's fees-for-technical-services article carry
   *  a "make available" test? That is what decides a standardised cloud service.
   *  mfnDerived  — the test comes from an MFN protocol rather than the treaty
   *  text, which is weaker after Nestlé (SC, 2023). */
  COUNTRIES: [
    { name: "United States",  makeAvailable: true,  ftsRate: 15 },
    { name: "United Kingdom", makeAvailable: true,  ftsRate: 15 },
    { name: "Canada",         makeAvailable: true,  ftsRate: 15 },
    { name: "Singapore",      makeAvailable: true,  ftsRate: 10 },
    { name: "Portugal",       makeAvailable: true,  ftsRate: 10 },
    { name: "Netherlands",    makeAvailable: true,  ftsRate: 10, mfnDerived: true },
    { name: "Sweden",         makeAvailable: true,  ftsRate: 10, mfnDerived: true },
    { name: "Ireland",        makeAvailable: false, ftsRate: 10 },
    { name: "Slovenia",       makeAvailable: false, ftsRate: 10 },
    { name: "Germany",        makeAvailable: false, ftsRate: 10 },
    { name: "France",         makeAvailable: false, ftsRate: 10 },
    { name: "Japan",          makeAvailable: false, ftsRate: 10 },
    { name: "Australia",      makeAvailable: false, ftsRate: 10 },
    { name: "Other — treaty country", makeAvailable: false, ftsRate: 10 },
    { name: "Other — no treaty",      noTreaty: true },
  ] as { name: string; makeAvailable?: boolean; ftsRate?: number; mfnDerived?: boolean; noTreaty?: boolean }[],

  /** Statutory references, in one place so the wording changes once. */
  REFS: {
    TDS: "s.393(2), Table Sl. No. 17",
    CERT: "s.395",
    FORM_145: "Form 145 (Rule 220)",
    FORM_146: "Form 146",
    PAYER_APP: "Form 129",
    PAYEE_APP: "Form 128",
    PENALTY: "s.462",
    EXEMPTION: "Rule 220(3)",
  },

  GST_RATE: 18,
};

/** Where the vendors we know sit. Seeds the questions so the desk answers
 *  fewer of them by hand. */
export const KNOWN_FOREIGN_VENDORS: Record<string, { country: string; category: ServiceCategory }> = {
  "Vercel":     { country: "United States", category: "standardised" },
  "Supabase":   { country: "United States", category: "standardised" },
  "Cloudflare": { country: "United States", category: "standardised" },
  "Bunny":      { country: "Slovenia",      category: "standardised" },
  "Anthropic":  { country: "United States", category: "standardised" },
  "Mailgun":    { country: "United States", category: "standardised" },
  "OpenAI":     { country: "United States", category: "standardised" },
  "Google":     { country: "Ireland",       category: "advertising" },
};

/* ═══════════════════════════════════════════════════════════════════════════
   THE QUESTIONS — what the accounts desk is asked, once per vendor
   ═══════════════════════════════════════════════════════════════════════════ */
export type ServiceCategory = "standardised" | "bespoke" | "advertising" | "mixed";

export type ForeignAnswers = {
  country: string;
  service_category: ServiceCategory;
  billing_frequency: "one" | "monthly" | "annual";
  has_trc: boolean;
  has_form10f: boolean;
  has_no_pe: boolean;
  has_395_cert: boolean;
  expected_annual: number | null;
};

export type Determination = {
  chargeable: boolean;
  tdsRate: number | null;          // null = the position needs advice
  tdsLabel: string;
  confidence: "high" | "medium" | "low";
  why: string;
  basis: string[];
  form145Part: "A" | "B" | "C" | "D" | null;
  form146Required: boolean;
  aggregate: number;
  projectedAnnual: number;
  grossedUp: number | null;
  certAdvice: { why: string; points: string[] } | null;
  payFrom: string;
  gst: string;
  warnings: string[];
  docsMissing: string[];
};

const countryOf = (name: string) =>
  FVD.COUNTRIES.find((c) => c.name === name) ?? FVD.COUNTRIES[FVD.COUNTRIES.length - 1];

function domesticEffective(aggregate: number) {
  const sc = FVD.RATES.SURCHARGE.find((s) => aggregate > s.above)?.pct ?? 0;
  const r = FVD.RATES.NO_TREATY * (1 + sc / 100) * (1 + FVD.RATES.CESS / 100);
  return Math.round(r * 100) / 100;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE REASONING
   ═══════════════════════════════════════════════════════════════════════════ */
export function determineForeign(
  a: ForeignAnswers,
  inv: { inrAmount: number; paidThisFy: number; gstRegistered: boolean },
): Determination {
  const R = FVD.REFS;
  const c = countryOf(a.country);
  // Everything paid to this vendor this financial year, this invoice included —
  // the figure the Form 145 part turns on.
  const aggregate = inv.paidThisFy + inv.inrAmount;
  const warnings: string[] = [];
  const docsMissing: string[] = [];

  type Verdict = { chargeable: boolean; rate: number | null; confidence: Determination["confidence"]; why: string; basis: string[] };

  const standardised = (): Verdict => {
    if (c.noTreaty) {
      return { chargeable: true, rate: domesticEffective(aggregate), confidence: "medium",
        why: `No treaty with ${a.country}, so the domestic rate applies in full — ${FVD.RATES.NO_TREATY}% plus cess.`,
        basis: [R.TDS] };
    }
    if (c.makeAvailable) {
      return { chargeable: false, rate: 0, confidence: "high",
        why: `A ready-made service nobody had to configure for you makes no technical knowledge available, and no source code or intellectual property changes hands. Under the ${a.country} treaty that is the whole test, and it is not met.`,
        basis: ["Engineering Analysis Centre of Excellence (SC, 2021)", "AWS cloud services — Delhi HC, upheld by the Supreme Court", `${a.country} treaty — make-available test`] };
    }
    return { chargeable: true, rate: c.ftsRate ?? 10, confidence: "medium",
      why: `The ${a.country} treaty has no make-available test, so the argument that clears the American vendors is not available here. The department is likely to call this a fee for technical services at ${c.ftsRate ?? 10}%. The contrary position is arguable but not settled.`,
      basis: [R.TDS, `${a.country} treaty — FTS article, no make-available test`] };
  };

  const bespoke = (): Verdict => {
    const haveDocs = a.has_trc && a.has_form10f;
    if (c.noTreaty || !haveDocs) {
      return { chargeable: true, rate: domesticEffective(aggregate), confidence: "high",
        why: c.noTreaty
          ? `Work done by a person is a fee for technical services, and there is no treaty with ${a.country} to reduce it.`
          : `Work done by a person is a fee for technical services. The ${a.country} treaty rate of ${c.ftsRate}% is available, but only once the vendor's tax residency certificate and Form 10F are on file. Until then the domestic rate applies.`,
        basis: [R.TDS] };
    }
    return { chargeable: true, rate: c.ftsRate ?? 10, confidence: "high",
      why: `Work done by a person is a fee for technical services, at the ${a.country} treaty rate of ${c.ftsRate ?? 10}% — the residency certificate and Form 10F are on file.`,
      basis: [R.TDS, `${a.country} treaty — FTS article`] };
  };

  let v: Verdict;
  if (a.service_category === "advertising") {
    v = { chargeable: true, rate: null, confidence: "low",
      why: "Advertising no longer has a levy of its own — the equalisation levy went at 2% from 1 August 2024 and at 6% from 1 April 2025 — so this runs through the ordinary withholding and treaty rules. Where it lands depends on what is being bought and from whom.",
      basis: [R.TDS, "Equalisation levy withdrawn"] };
    warnings.push("Advertising needs its own advice before this is remitted. The desk deliberately proposes no rate for it.");
  } else if (a.service_category === "mixed") {
    v = bespoke();
    v.why = `A mixed invoice that was not split is treated in full as work done for you, which is the stricter reading. ${v.why}`;
    warnings.push("Ask this vendor for a split between the ready-made part and the work-done part — it would very likely lower the withholding.");
  } else if (a.service_category === "bespoke") {
    v = bespoke();
  } else {
    v = standardised();
  }

  let { chargeable, rate, confidence, why, basis } = v;

  if (c.mfnDerived && a.service_category === "standardised") {
    warnings.push(`The make-available test for ${a.country} comes from the treaty's most-favoured-nation protocol rather than its own text. After Nestlé (SC, 2023) that route needs a notification before it can be claimed.`);
    if (confidence === "high") confidence = "medium";
  }

  // Treaty relief without the papers behind it.
  const claimingTreaty = !c.noTreaty && (!chargeable || rate === c.ftsRate);
  if (claimingTreaty) {
    if (!a.has_trc) docsMissing.push("tax residency certificate");
    if (!a.has_form10f) docsMissing.push("Form 10F");
    if (!a.has_no_pe) docsMissing.push("no-permanent-establishment declaration");
    if (docsMissing.length) {
      warnings.push(
        `Relying on the ${a.country} treaty without ${docsMissing.join(", ")} on file. ` +
        (confidence === "high"
          ? "The position itself is sound, but it is not defensible in an assessment until those are collected."
          : "On a position that is already arguable, going without those papers leaves nothing to stand on."),
      );
    }
  }

  // Which part of Form 145, and does an accountant's certificate arise?
  const over = aggregate > FVD.THRESHOLDS.FORM_145_AGGREGATE;
  let form145Part: Determination["form145Part"];
  let form146Required = false;
  if (!chargeable) form145Part = "D";
  else if (!over) form145Part = "A";
  else if (a.has_395_cert) form145Part = "B";
  else { form145Part = "C"; form146Required = true; }

  if (form146Required) {
    warnings.push(
      `One ${R.FORM_146} covers exactly one ${R.FORM_145}; they cannot be bundled for a year.` +
      (a.billing_frequency === "monthly" ? " On monthly billing that is about twelve of each over the year." : ""),
    );
  }

  const projectedAnnual = Math.max(
    a.billing_frequency === "monthly" ? inv.inrAmount * 12 : a.billing_frequency === "annual" ? inv.inrAmount : aggregate,
    aggregate,
    a.expected_annual ?? 0,
  );

  const certAdvice =
    a.service_category !== "advertising" && chargeable && !a.has_395_cert &&
    projectedAnnual > FVD.THRESHOLDS.FORM_145_AGGREGATE &&
    (confidence !== "high" || a.billing_frequency !== "one")
      ? {
          why: `At roughly ₹${Math.round(projectedAnnual).toLocaleString("en-IN")} a year this vendor sits above the ₹5,00,000 line` +
               (a.billing_frequency !== "one" ? ", on repeating billing" : "") +
               (confidence !== "high" ? ", on a position that is arguable rather than settled" : "") + ".",
          points: [
            `Apply on ${R.PAYER_APP} — the payer's own application, which needs nothing from the vendor.`,
            `Not ${R.PAYEE_APP}: that is the payee's application and needs the vendor's Indian PAN and their cooperation.`,
            "File with the International Taxation assessing officer holding the jurisdiction.",
            `A certificate moves every remittance to Part B, which needs no ${R.FORM_146} — one application replaces roughly twelve accountant's certificates.`,
            "Certificates are not retrospective. Apply before the year's payments begin.",
          ],
        }
      : null;

  return {
    chargeable,
    tdsRate: rate,
    tdsLabel: !chargeable ? "Nil" : rate === null ? "needs advice" : `${rate}%`,
    confidence, why, basis,
    form145Part, form146Required,
    aggregate, projectedAnnual,
    grossedUp: rate ? Number((inv.inrAmount / (1 - rate / 100)).toFixed(2)) : null,
    certAdvice,
    payFrom: "India current account — it is the account that keeps the withholding and Form 145 trail intact, and the trail is what preserves the deduction",
    gst: inv.gstRegistered
      ? `Reverse charge at ${FVD.GST_RATE}% — self-invoice, ITC subject to eligibility`
      : `The supplier charges ${FVD.GST_RATE}% IGST on their own invoice`,
    warnings, docsMissing,
  };
}
