// WHAT AN INVOICE ACTUALLY IS, AND WHAT THAT MAKES THE ENTRY.
//
// A paper that arrives is not automatically an expense. It may be an asset, it
// may be his own household spending, it may be income, it may be a liability,
// and it may be the REVERSAL of any of those — a debit note against a supplier
// or a credit note to a customer. Booking all of them to an expense head is the
// quickest way to a wrong profit figure and a wrong balance sheet.
//
// And the withholding is a second decision on top: TDS either comes OUT of what
// the supplier is paid, or is borne on top of it. Those are different entries
// for the same invoice, so the desk asks rather than assumes.
//
// Everything here is answered once per supplier and then remembered.

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT IT IS
   ═══════════════════════════════════════════════════════════════════════════ */
export type Nature =
  | "expense"           // running the business
  | "asset"             // something we keep
  | "drawings"          // his own, not the business's
  | "income"            // money earned
  | "liability"         // something owed
  | "expense_reversal"  // a supplier crediting us back — debit note
  | "income_reversal";  // us crediting a customer — credit note

export type Operating = "operating" | "non_operating";

export const NATURES: { value: Nature; label: string; hint: string; asksOperating: boolean }[] = [
  { value: "expense",          label: "An expense",                     hint: "the cost of running the business", asksOperating: true },
  { value: "asset",            label: "An asset we keep",               hint: "equipment, deposits, software we own", asksOperating: true },
  { value: "drawings",         label: "Personal — not the business's",  hint: "goes to drawings, never to the P&L", asksOperating: false },
  { value: "income",           label: "Income",                         hint: "money earned, not spent", asksOperating: true },
  { value: "liability",        label: "A liability",                    hint: "something owed, not an expense yet", asksOperating: true },
  { value: "expense_reversal", label: "A supplier credit (debit note)", hint: "reverses an expense already booked", asksOperating: false },
  { value: "income_reversal",  label: "A credit note we are giving",    hint: "reverses income already booked", asksOperating: false },
];

/**
 * Where a NEW ledger belongs in Zoho when he names one that does not exist.
 *
 * Operating and non-operating are not decoration: they decide whether a cost
 * sits in the trading result or below it, and whether an asset is current or
 * fixed. Getting this from him at the moment he names the ledger is the only
 * time anybody actually knows.
 */
export function zohoAccountType(nature: Nature, operating: Operating): string {
  switch (nature) {
    case "expense":
    case "expense_reversal":
      return operating === "operating" ? "expense" : "other_expense";
    case "asset":
      return operating === "operating" ? "other_current_asset" : "fixed_asset";
    case "drawings":
      return "equity";                       // owner's drawings sit in equity, never in the P&L
    case "income":
    case "income_reversal":
      return operating === "operating" ? "income" : "other_income";
    case "liability":
      return operating === "operating" ? "other_current_liability" : "long_term_liability";
  }
}

/**
 * The ledgers worth offering for what he has just said this is.
 *
 * Showing all five hundred accounts for every invoice is the same as showing
 * none: the answer he has already given — an operating expense, a fixed asset —
 * names exactly one shelf of the chart, so that is the shelf he is offered. The
 * rest stay reachable, because a real chart always has something filed in an
 * odd place, and a new name can always be typed.
 */
export function ledgersFor(
  accounts: { name: string; type: string }[], nature: Nature, operating: Operating,
): { best: string[]; rest: string[] } {
  const want = zohoAccountType(nature, operating);
  // The neighbouring shelf, offered after the right one rather than hidden:
  // an expense filed under "other expense" is a filing choice, not an error.
  const near: Record<string, string[]> = {
    expense: ["other_expense", "cost_of_goods_sold"],
    other_expense: ["expense"],
    other_current_asset: ["fixed_asset", "other_asset"],
    fixed_asset: ["other_current_asset", "other_asset"],
    income: ["other_income"],
    other_income: ["income"],
    other_current_liability: ["long_term_liability", "other_liability"],
    long_term_liability: ["other_current_liability", "other_liability"],
    equity: [],
  };
  const alsoOk = new Set([want, ...(near[want] ?? [])]);
  const best = accounts.filter((a) => a.type === want).map((a) => a.name).sort();
  const rest = accounts.filter((a) => a.type !== want && alsoOk.has(a.type)).map((a) => a.name).sort();
  return { best, rest };
}

/** Which Zoho document this becomes. */
export function zohoDocument(nature: Nature): "bill" | "vendor_credit" | "credit_note" | "journal" {
  if (nature === "expense" || nature === "asset" || nature === "drawings") return "bill";
  if (nature === "expense_reversal") return "vendor_credit";
  if (nature === "income_reversal") return "credit_note";
  return "journal";                          // income and liabilities
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WITHHOLDING — DEDUCTED, OR BORNE
   ═══════════════════════════════════════════════════════════════════════════ */
export type TdsMode = "none" | "deduct" | "gross_up";

export type TdsWorking = {
  mode: TdsMode;
  rate: number;
  /** What the books carry as the cost. */
  bookedAmount: number;
  /** What the supplier actually receives. */
  vendorGets: number;
  /** What goes to the government. */
  tds: number;
  /** The entry, in words he can check at a glance. */
  sentence: string;
};

/**
 * The same invoice, two entries.
 *
 * DEDUCTED — the ordinary case. The supplier's ₹2,365 bill is booked at ₹2,365,
 * they are paid ₹2,128.50, and ₹236.50 goes to the government against their PAN.
 *
 * BORNE (grossed up) — a foreign supplier who bills by card will not accept less
 * than their invoice. The tax is still due, so it is paid on top: the cost to
 * the business is ₹2,365 ÷ (1 − 10%) = ₹2,627.78, of which the supplier keeps
 * ₹2,365 and ₹262.78 goes to the government. Booking that at ₹2,365 understates
 * the cost and leaves the withholding unfunded.
 */
/**
 * TDS, ROUNDED TO THE RUPEE — HIS RULE, IN ONE PLACE.
 *
 * "The TDS roundup is to be done." Section 288B rounds withholding to the
 * nearest rupee, and that is what the challan carries.
 *
 * It lived only in the preview, so on FIRST FLY the screen showed ₹60.00 while
 * ₹59.77 was stored and would have posted — the figure he approved and the
 * figure that reached Zoho were not the same number. That is the same drift
 * that put a different title on the phone from the one on Telegram, and it is
 * fixed the same way: one function, used by both sides.
 */
export const roundTds = (n: number) => Math.round(Number(n) || 0);

export function tdsWorking(invoiceInr: number, mode: TdsMode, rate: number, who: string): TdsWorking {
  const money = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (mode === "none" || !rate) {
    return {
      mode: "none", rate: 0, bookedAmount: invoiceInr, vendorGets: invoiceInr, tds: 0,
      sentence: `No withholding. ${who} is paid ${money(invoiceInr)} and that is the cost.`,
    };
  }
  if (mode === "deduct") {
    const tds = roundTds(invoiceInr * rate / 100);
    return {
      mode, rate, bookedAmount: invoiceInr, vendorGets: Number((invoiceInr - tds).toFixed(2)), tds,
      sentence: `Cost ${money(invoiceInr)}. ${who} is paid ${money(invoiceInr - tds)} and ${money(tds)} goes to the government.`,
    };
  }
  const gross = Number((invoiceInr / (1 - rate / 100)).toFixed(2));
  const tds = Number((gross - invoiceInr).toFixed(2));
  return {
    mode, rate, bookedAmount: gross, vendorGets: invoiceInr, tds,
    sentence: `${who} keeps their full ${money(invoiceInr)}, so the tax is borne on top: cost becomes ${money(gross)} and ${money(tds)} goes to the government.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ENTRY, IN WORDS
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * What the document IS, in one clause — shared by both sides of the books.
 *
 * The money clause after it differs: on a supplier bill we pay and may withhold,
 * on our own invoice we are paid and the customer withholds. Reusing the paying
 * side's wording on an invoice produced "the customer is paid ₹0.00 and that is
 * the cost", which is backwards in every particular.
 */
export function natureClause(nature: Nature, operating: Operating, account: string, subAccount?: string | null): string {
  const head = subAccount ? `${account} — ${subAccount}` : account;
  return nature === "drawings" ? `Drawings: ${head}. Nothing reaches the profit and loss account.`
    : nature === "asset" ? `Held as an asset: ${head} (${operating === "operating" ? "current" : "fixed"}).`
    : nature === "income" ? `Income: ${head} (${operating === "operating" ? "operating" : "other"}).`
    : nature === "liability" ? `A liability: ${head}. No cost until it is incurred.`
    : nature === "expense_reversal" ? `Reverses an expense already booked to ${head}.`
    : nature === "income_reversal" ? `Reverses income already booked to ${head}.`
    : `Expense: ${head} (${operating === "operating" ? "operating" : "non-operating"}).`;
}

export function entrySentence(p: {
  nature: Nature; operating: Operating; account: string; subAccount?: string | null;
  gstTreatment: string; gstRate: number; tds: TdsWorking; who: string;
}): string {
  const head = p.subAccount ? `${p.account} — ${p.subAccount}` : p.account;
  const what =
    p.nature === "drawings" ? `Drawings: ${head}. Nothing reaches the profit and loss account.`
    : p.nature === "asset" ? `Held as an asset: ${head} (${p.operating === "operating" ? "current" : "fixed"}).`
    : p.nature === "income" ? `Income: ${head} (${p.operating === "operating" ? "operating" : "other"}).`
    : p.nature === "liability" ? `A liability: ${head}. No cost until it is incurred.`
    : p.nature === "expense_reversal" ? `Reverses an expense already booked to ${head}.`
    : p.nature === "income_reversal" ? `Reverses income already booked to ${head}.`
    : `Expense: ${head} (${p.operating === "operating" ? "operating" : "non-operating"}).`;

  // NO INPUT CREDIT ON WHAT IS NOT THE BUSINESS'S. Personal spending cannot
  // carry ITC, so on drawings the GST is part of the cost, not something to
  // claim back — saying otherwise would be a wrong claim in the return.
  const personal = p.nature === "drawings";
  const gst =
    p.gstTreatment === "none" ? " No GST."
    : personal
      ? ` GST ${p.gstRate}%${p.gstTreatment === "rcm" ? " under reverse charge" : ""} — a cost, with no input credit, because this is not the business's.`
    : p.gstTreatment === "rcm" ? ` GST ${p.gstRate}% under reverse charge — we pay it and claim it back.`
    : ` GST ${p.gstRate}% charged by them, claimed as input credit.`;

  return `${what}${gst} ${p.tds.sentence}`;
}
