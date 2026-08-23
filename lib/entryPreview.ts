import type { Nature, TdsWorking } from "@/lib/postingShape";

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

export type EntryLine = { account: string; side: "debit" | "credit"; amount: number; note?: string };
export type Entry = { lines: EntryLine[]; dr: number; cr: number; balanced: boolean; caveats: string[] };

const r2 = (n: number) => Number((Number(n) || 0).toFixed(2));

function finish(lines: EntryLine[], caveats: string[]): Entry {
  const kept = lines.filter((l) => Math.abs(l.amount) >= 0.01).map((l) => ({ ...l, amount: r2(l.amount) }));
  const dr = r2(kept.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0));
  const cr = r2(kept.filter((l) => l.side === "credit").reduce((t, l) => t + l.amount, 0));
  return { lines: kept, dr, cr, balanced: Math.abs(dr - cr) < 0.02, caveats };
}

/** Where the other side of a purchase sits until it is paid. */
export const payableFor = (who: string) => `${who || "the supplier"} (payable)`;
export const receivableFor = (who: string) => `${who || "the customer"} (receivable)`;

/* ═══════════════════════════════════════════════════════════════════════════
   SOMETHING WE BOUGHT — a supplier's bill
   ═══════════════════════════════════════════════════════════════════════════ */
export function purchaseEntry(p: {
  who: string;
  account: string;
  subAccount?: string | null;
  nature: Nature | string;
  /** "rcm" | "itc" | "none" — as the desk classifies it. */
  gstTreatment: string;
  gstRate: number;
  /** The working already done: booked amount, the withholding, and what is paid. */
  tds: TdsWorking;
  tdsSection?: string | null;
}): Entry {
  const base = r2(p.tds.bookedAmount);
  const gstRate = Number(p.gstRate) || 0;
  const gst = p.gstTreatment === "none" ? 0 : r2((base * gstRate) / 100);
  const head = p.subAccount ? `${p.account} — ${p.subAccount}` : (p.account || "— no ledger chosen —");
  const caveats: string[] = [];

  const lines: EntryLine[] = [];

  // PERSONAL SPENDING CANNOT CARRY INPUT CREDIT. On drawings the GST is part of
  // what was spent, so it is debited to the same head — claiming it would be a
  // wrong claim in the return.
  const personal = p.nature === "drawings";
  if (personal && gst > 0) {
    lines.push({ account: head, side: "debit", amount: base + gst, note: "the whole cost including GST — no input credit on what is not the business's" });
  } else {
    lines.push({ account: head, side: "debit", amount: base, note: "the value of what was supplied" });
  }

  if (!personal && p.gstTreatment === "itc" && gst > 0) {
    lines.push({ account: `Input GST ${gstRate}%`, side: "debit", amount: gst, note: "charged by them on the invoice, claimed as input credit" });
  }

  if (!personal && p.gstTreatment === "rcm" && gst > 0) {
    lines.push({ account: `Input IGST ${gstRate}% (reverse charge)`, side: "debit", amount: gst, note: "self-assessed on an imported service — Zoho raises this pair itself from the reverse-charge flag" });
    lines.push({ account: `IGST ${gstRate}% payable (reverse charge)`, side: "credit", amount: gst, note: "paid to the government with the return, then claimed back" });
    caveats.push("Under reverse charge the supplier charges nothing, so the two GST lines cancel and the vendor is credited with the invoice only.");
  }

  const withheld = r2(p.tds.tds);
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

  const payable = (personal ? base + gst : base + (p.gstTreatment === "itc" ? gst : 0)) - withheld;
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
}): Entry {
  const base = r2(p.amount);
  const gstRate = Number(p.gstRate) || 0;
  const gst = p.gstTreatment === "charged" ? r2((base * gstRate) / 100) : 0;
  const head = p.subAccount ? `${p.account} — ${p.subAccount}` : (p.account || "— no ledger chosen —");
  const withheld = r2((base * (Number(p.tdsRate) || 0)) / 100);
  const caveats: string[] = [];

  const lines: EntryLine[] = [];
  const flip = (side: "debit" | "credit"): "debit" | "credit" =>
    p.isCreditNote ? (side === "debit" ? "credit" : "debit") : side;

  lines.push({ account: head, side: flip("credit"), amount: base, note: p.isCreditNote ? "the income being taken back" : "what we earned" });

  if (gst > 0) {
    if (p.intraState) {
      lines.push({ account: `Output CGST ${gstRate / 2}%`, side: flip("credit"), amount: r2(gst / 2), note: "collected from them and owed to the government" });
      lines.push({ account: `Output SGST ${gstRate / 2}%`, side: flip("credit"), amount: r2(gst / 2), note: "collected from them and owed to the government" });
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

  lines.push({
    account: receivableFor(p.who),
    side: flip("debit"),
    amount: base + gst - withheld,
    note: withheld > 0 ? "what they will actually remit" : "what they owe us",
  });

  if (p.isCreditNote) caveats.push("A credit note reverses the invoice, so every side is the other way round.");
  return finish(lines, caveats);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONEY THAT MOVED — a bank line, and a settlement against open documents
   ═══════════════════════════════════════════════════════════════════════════ */
export function bankEntry(p: {
  bank: string;
  account: string;
  debit: number;
  credit: number;
}): Entry {
  const out = r2(p.debit), inn = r2(p.credit);
  const head = p.account || "— no ledger chosen —";
  return out > 0
    ? finish([
        { account: head, side: "debit", amount: out, note: "what the money was spent on" },
        { account: p.bank, side: "credit", amount: out, note: "left the bank" },
      ], [])
    : finish([
        { account: p.bank, side: "debit", amount: inn, note: "reached the bank" },
        { account: head, side: "credit", amount: inn, note: "what the money was for" },
      ], []);
}

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
