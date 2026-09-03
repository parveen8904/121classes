import type { Nature, TdsWorking } from "@/lib/postingShape";

// The entry's shape, and the bank line's entry, live in lib/entryShape.ts so a
// test can load them without the "@/" alias. Re-exported here because every
// caller — the panels, the approvals, the statements page — knows this address.
import { r2, finish, payableFor, receivableFor, type Entry, type EntryLine } from "@/lib/entryShape";
export { payableFor, receivableFor, bankEntry } from "@/lib/entryShape";
export type { Entry, EntryLine, BankEntryKind } from "@/lib/entryShape";

// THE ENTRY AS DEBITS AND CREDITS, BEFORE ANYBODY APPROVES ANYTHING.
//
// The desk already stated each posting in a sentence, and a sentence is not
// what an accountant checks. He checks the entry: which ledger is debited,
// which is credited, and for how much. So every approval on this desk shows the
// same thing the brokerage note shows — the ledger entry it becomes.
//
// WHAT THIS IS AND IS NOT. Zoho is not sent a journal for a bill or an invoice;
// it is sent the document, and Zoho derives the double entry from it. This
// derives the SAME double entry from the SAME inputs — the head chosen, the GST
// treatment, the withholding — so it shows what the document will do to the
// ledgers. Where Zoho's own machinery makes a line (the reverse-charge pair,
// its TDS ledger), that is said on the line rather than implied.

/* ═══════════════════════════════════════════════════════════════════════════
   SOMETHING WE BOUGHT — a supplier's bill
   ═══════════════════════════════════════════════════════════════════════════ */
/** Rounded to the nearest rupee — his ruling, 24 Aug 2026. */
// The rounding lives with the working that produces the posted figure, so the
// screen and the entry cannot disagree. Re-exported for callers that had it here.
import { roundTds } from "@/lib/postingShape";
export { roundTds };

export function purchaseEntry(p: {
  who: string;
  account: string;
  subAccount?: string | null;
  nature: Nature | string;
  /** "rcm" | "domestic_itc" | "none" — as the desk classifies it. */
  gstTreatment: string;
  gstRate: number;
  /** The working already done: booked amount, the withholding, and what is paid. */
  tds: TdsWorking;
  tdsSection?: string | null;
  /** THE TAX AS THE INVOICE PRINTS IT — never derived. See the note below. */
  stated?: { taxable?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null } | null;
}): Entry {
  const gstRate = Number(p.gstRate) || 0;
  const head = p.subAccount ? `${p.account} — ${p.subAccount}` : (p.account || "— no ledger chosen —");
  const caveats: string[] = [];
  const lines: EntryLine[] = [];

  // "THEY CHARGED IT" IS SPELLED domestic_itc, AND THIS TESTED FOR "itc".
  //
  // The form has always saved domestic_itc; this compared against "itc", so the
  // two never met. The input-credit line was therefore never added to a single
  // domestic bill, and the whole tax-inclusive total was debited to the expense
  // head: FIRST FLY EXPRESS 480/2026 booked ₹7,053 of courier expense when the
  // expense was ₹5,977 and ₹1,075.86 was tax we can reclaim.
  const claimsItc = p.gstTreatment === "domestic_itc" || p.gstTreatment === "itc";

  // THE TAX IS READ, NOT CALCULATED.
  //
  // His ruling: "you cannot derive it on your own — you have to check it from
  // the invoice." A supplier rounds each line, can bill more than one rate on
  // one document, and can add cess or a discount, so gross ÷ 1.18 is a guess
  // that will not reconcile. FIRST FLY is the proof: 5,977 + 537.93 + 537.93 is
  // 7,052.86, fourteen paise below the 7,053 on the face of the bill.
  //
  // Where the stated figures are present they are used exactly. Where they are
  // not — an older bill, or one nobody has keyed the tax into — the entry falls
  // back to the old arithmetic AND SAYS SO, because a derived tax figure
  // presented silently as fact is the thing being corrected here.
  const st = p.stated ?? null;
  const statedCgst = r2(Number(st?.cgst ?? 0));
  const statedSgst = r2(Number(st?.sgst ?? 0));
  const statedIgst = r2(Number(st?.igst ?? 0));
  const statedTax = r2(statedCgst + statedSgst + statedIgst);
  const statedTaxable = st?.taxable != null && Number(st.taxable) > 0 ? r2(Number(st.taxable)) : null;
  const haveStated = statedTaxable != null && statedTax > 0;

  // NOTHING IS DERIVED. IF THE INVOICE HAS NOT BEEN READ, THERE IS NO ENTRY.
  //
  // His ruling, 24 Aug 2026: "You will pick everything from the invoice only and
  // that will be mentioned as CGST IGST SGST. You will not derive on your own."
  //
  // So the earlier fallback — work the tax out from the rate and note that we
  // had — is gone. A derived entry is a guess with an approve button beside it,
  // and it was that guess which put ₹7,053 of courier expense in the books when
  // the expense was ₹5,977. Where the tax has not been keyed, this returns NO
  // entry and says why, and the desk cannot approve what it cannot see.
  //
  // WHICH TAX APPLIES IS ALSO THE INVOICE'S ANSWER, NOT OURS. A bill showing
  // CGST and SGST is an intra-state supply; one showing IGST is inter-state.
  // That is already stated on the document, so there is no supplier-state
  // lookup here and no rule deciding it — the boxes that are filled in are the
  // answer.
  if (claimsItc && !haveStated) {
    return finish([], [
      "The tax on this bill has not been read off the invoice yet, so there is no entry to show and nothing to approve. " +
      "Open the bill and key its taxable value and the CGST/SGST/IGST exactly as printed. Nothing here is worked out from the rate — " +
      "a supplier rounds each line and may bill more than one rate, so a derived figure would not match the document.",
    ]);
  }

  const base = haveStated ? statedTaxable! : r2(p.tds.bookedAmount);
  // Reverse charge is the one place a figure is not read off the invoice, and
  // it cannot be: the supplier charges nothing at all, and the tax is the one
  // WE self-assess at the notified rate under the statute.
  const gst = p.gstTreatment === "none" ? 0 : haveStated ? statedTax : r2((base * gstRate) / 100);

  // PERSONAL SPENDING CANNOT CARRY INPUT CREDIT. On drawings the GST is part of
  // what was spent, so it is debited to the same head — claiming it would be a
  // wrong claim in the return.
  const personal = p.nature === "drawings";
  if (personal && gst > 0) {
    lines.push({ account: head, side: "debit", amount: base + gst, note: "the whole cost including GST — no input credit on what is not the business's" });
  } else {
    lines.push({ account: head, side: "debit", amount: base, note: "the value of what was supplied" });
  }

  // CGST AND SGST ARE TWO LEDGERS, NOT ONE. They are separate credits in the
  // return and are reclaimed separately, so a single merged "Input GST" line
  // could not be filed from.
  if (!personal && claimsItc && gst > 0) {
    if (haveStated) {
      if (statedCgst > 0) lines.push({ account: "Input CGST", side: "debit", amount: statedCgst, note: "as charged on the invoice, claimed as input credit" });
      if (statedSgst > 0) lines.push({ account: "Input SGST", side: "debit", amount: statedSgst, note: "as charged on the invoice, claimed as input credit" });
      if (statedIgst > 0) lines.push({ account: "Input IGST", side: "debit", amount: statedIgst, note: "as charged on the invoice, claimed as input credit" });
    }
  }

  if (!personal && p.gstTreatment === "rcm" && gst > 0) {
    lines.push({ account: `Input IGST ${gstRate}% (reverse charge)`, side: "debit", amount: gst, note: "self-assessed on an imported service — Zoho raises this pair itself from the reverse-charge flag" });
    lines.push({ account: `IGST ${gstRate}% payable (reverse charge)`, side: "credit", amount: gst, note: "paid to the government with the return, then claimed back" });
    caveats.push("Under reverse charge the supplier charges nothing, so the two GST lines cancel and the vendor is credited with the invoice only.");
  }

  // WITHHOLD ON THE VALUE, NOT ON THE TAX — AND ROUND TO THE RUPEE.
  //
  // Two corrections in one line. TDS was taken on the tax-inclusive total, so
  // FIRST FLY was withheld ₹70.53 (1% of 7,053) when the deduction is 1% of the
  // taxable 5,977 = ₹59.77: GST shown separately on an invoice is not part of
  // the sum on which tax is deducted at source. And it was carried to the
  // paisa, where a challan is paid in whole rupees — his ruling is the nearest
  // rupee, so ₹59.77 is withheld as ₹60.
  //
  // Grossing up is left exactly as tdsWorking computed it: there the invoice is
  // what the supplier keeps and the tax is built on top, which is a different
  // sum and not one to re-derive here.
  const withheld =
    p.tds.mode === "deduct" && Number(p.tds.rate) > 0
      ? roundTds((base * Number(p.tds.rate)) / 100)
      : r2(p.tds.tds);
  if (withheld > 0) {
    const sec = (p.tdsSection ?? "").trim();
    lines.push({
      account: `TDS payable${sec ? ` — ${sec}` : ""}`,
      side: "credit",
      amount: withheld,
      note: p.tds.mode === "gross_up"
        ? "withheld and paid to the government — borne by us, so the bill is raised at the grossed-up figure above"
        : "withheld from the supplier and paid to the government",
    });
  }

  // Reverse charge is the exception: the supplier charged nothing, so what is
  // owed to them is the invoice alone and the two GST lines cancel each other.
  const payable = (personal ? base + gst : base + (claimsItc ? gst : 0)) - withheld;
  lines.push({
    account: payableFor(p.who),
    side: "credit",
    amount: payable,
    note: withheld > 0 ? "what is actually left to pay them" : "what is owed to them",
  });

  if (p.tds.mode === "gross_up") {
    caveats.push(`The invoice is ${p.who || "the supplier"}'s own figure; the entry is at the grossed-up value because the withholding is borne by us.`);
  }
  return finish(lines, caveats);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOMETHING WE SOLD — our own invoice, or a credit note reversing one
   ═══════════════════════════════════════════════════════════════════════════ */
export function saleEntry(p: {
  who: string;
  account: string;
  subAccount?: string | null;
  /** "charged" | "exempt" | "zero" | "none" */
  gstTreatment: string;
  gstRate: number;
  /** Intra-state splits into CGST + SGST; anything else is IGST. */
  intraState?: boolean;
  amount: number;
  /** What the customer withholds from what they pay us. */
  tdsRate?: number;
  isCreditNote?: boolean;
  /** THE TAX-INCLUSIVE PRICE, WHEN THAT IS WHAT THE CUSTOMER PAID.
   *
   * Portal prices are inclusive and the invoice goes to Zoho as
   * is_inclusive_tax with the gross — Zoho then works the tax out so that
   * base + tax equals the gross TO THE PAISA. The preview used to divide
   * the gross, round the base, and re-derive the tax from that rounded
   * base, which put ₹2,700.01 on screen for a ₹2,700 receipt. A preview
   * one paisa away from the receipt is not the entry that will be posted.
   * Given here, the split is done the way Zoho does it: base rounded,
   * tax = gross − base, so the total is the receipt exactly. */
  inclusiveGross?: number | null;
  /** WHERE THE MONEY LANDED, WHEN IT IS ALREADY IN.
   *
   * His question, 25 Aug 2026: "the party stands debited, and when you receive
   * the money you say bank debit — how will you clear that party?"
   *
   * It IS cleared: postSale writes TWO documents, the invoice and then a
   * customer payment applied to that invoice (invoices:[{invoice_id,
   * amount_applied}]), which knocks the receivable off. The preview showed
   * only the invoice, so on screen the party stood debited for ever — the
   * entry was true and half-told, which for a receivable is the same as wrong.
   *
   * Given here, the receipt leg is shown too: Dr this account, Cr the party,
   * for the gross. The party nets to nil in the same breath, which is what
   * actually happens in Zoho. */
  settledInto?: string | null;
}): Entry {
  const gstRate = Number(p.gstRate) || 0;
  const inc = p.inclusiveGross != null && p.inclusiveGross > 0 ? r2(p.inclusiveGross) : null;
  const base = inc != null && p.gstTreatment === "charged"
    ? r2(inc / (1 + gstRate / 100))
    : r2(p.amount);
  const gst = p.gstTreatment === "charged" ? (inc != null ? r2(inc - base) : r2((base * gstRate) / 100)) : 0;
  const head = p.subAccount ? `${p.account} — ${p.subAccount}` : (p.account || "— no ledger chosen —");
  const withheld = r2((base * (Number(p.tdsRate) || 0)) / 100);
  const caveats: string[] = [];

  const lines: EntryLine[] = [];
  const flip = (side: "debit" | "credit"): "debit" | "credit" =>
    p.isCreditNote ? (side === "debit" ? "credit" : "debit") : side;

  lines.push({ account: head, side: flip("credit"), amount: base, note: p.isCreditNote ? "the income being taken back" : "what we earned" });

  if (gst > 0) {
    if (p.intraState) {
      // The halves must re-add to the tax exactly; rounding each half
      // independently loses a paisa on odd amounts.
      const cg = r2(gst / 2);
      lines.push({ account: `Output CGST ${gstRate / 2}%`, side: flip("credit"), amount: cg, note: "collected from them and owed to the government" });
      lines.push({ account: `Output SGST ${gstRate / 2}%`, side: flip("credit"), amount: r2(gst - cg), note: "collected from them and owed to the government" });
    } else {
      lines.push({ account: `Output IGST ${gstRate}%`, side: flip("credit"), amount: gst, note: "collected from them and owed to the government" });
    }
  }

  if (withheld > 0) {
    lines.push({
      account: "TDS receivable (26AS)",
      side: flip("debit"),
      amount: withheld,
      note: "withheld by them against our PAN — money we are owed, not a cost; watch it into 26AS",
    });
    caveats.push("The customer deducts this from what they pay us and gives the government credit against our PAN. It is a receivable, never an expense.");
  }

  const owed = base + gst - withheld;
  lines.push({
    account: receivableFor(p.who),
    side: flip("debit"),
    amount: owed,
    note: withheld > 0 ? "what they will actually remit" : "what they owe us",
  });

  // THE RECEIPT, WHERE THE MONEY IS ALREADY IN. Shown as its own two lines so
  // the party is seen to clear rather than merely asserted to.
  if (p.settledInto && !p.isCreditNote && owed > 0) {
    lines.push({ account: p.settledInto, side: "debit", amount: owed, note: "the money, already received" });
    lines.push({ account: receivableFor(p.who), side: "credit", amount: owed, note: "…and the party is squared off — nothing is left outstanding" });
    caveats.push(
      `${p.who || "The customer"} nets to nil: debited by the invoice and credited by the receipt, both for ${
        owed.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }. Zoho is sent the invoice and then a payment applied against it, which is what squares the account — no balance is left standing.`,
    );
  }

  if (p.isCreditNote) caveats.push("A credit note reverses the invoice, so every side is the other way round.");
  return finish(lines, caveats);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONEY THAT MOVED — a bank line, and a settlement against open documents
   ═══════════════════════════════════════════════════════════════════════════ */
export function settlementEntry(p: {
  bank: string;
  party: string;
  amount: number;
  kind: "bill" | "invoice";
}): Entry {
  const amt = r2(p.amount);
  return p.kind === "bill"
    ? finish([
        { account: payableFor(p.party), side: "debit", amount: amt, note: "clears what was owed on the bill — the cost was booked when the bill arrived" },
        { account: p.bank, side: "credit", amount: amt, note: "paid out of the bank" },
      ], ["This settles an existing bill. Booking it as an expense again would count the cost twice and leave the bill open for ever."])
    : finish([
        { account: p.bank, side: "debit", amount: amt, note: "received into the bank" },
        { account: receivableFor(p.party), side: "credit", amount: amt, note: "clears what they owed on the invoice — the income was booked when the invoice was raised" },
      ], ["This settles an existing invoice. Booking it as income again would count the same sale twice."]);
}
