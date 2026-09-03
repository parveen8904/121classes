// THE SHAPE OF AN ENTRY — AND THE ONE A BANK LINE MAKES.
//
// Split out of lib/entryPreview.ts on 3 September 2026 so it can be RUN.
//
// The direction a bank line is booked in is the thing that went wrong for him
// — "we got 6900 back from a person… but it is showing drawings account debit
// to Bank" — so it is exactly the thing that ought to be under test. It could
// not be: entryPreview.ts imports roundTds through the "@/" alias, which node
// cannot resolve, so nothing in that file could be loaded by a test at all.
//
// The same move as lib/bankStatementRows.ts, for the same reason. Nothing here
// imports anything. entryPreview.ts re-exports all of it, so every existing
// caller keeps the address it already knows.

export type EntryLine = { account: string; side: "debit" | "credit"; amount: number; note?: string };
export type Entry = { lines: EntryLine[]; dr: number; cr: number; balanced: boolean; caveats: string[] };

export const r2 = (n: number) => Number((Number(n) || 0).toFixed(2));

export function finish(lines: EntryLine[], caveats: string[]): Entry {
  const kept = lines.filter((l) => Math.abs(l.amount) >= 0.01).map((l) => ({ ...l, amount: r2(l.amount) }));
  const dr = r2(kept.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0));
  const cr = r2(kept.filter((l) => l.side === "credit").reduce((t, l) => t + l.amount, 0));
  return { lines: kept, dr, cr, balanced: Math.abs(dr - cr) < 0.02, caveats };
}

/** Where the other side of a purchase sits until it is paid. */
export const payableFor = (who: string) => `${who || "the supplier"} (payable)`;
export const receivableFor = (who: string) => `${who || "the customer"} (receivable)`;


/** What a bank line can be told to become. See lib/bankStatements.ts. */
export type BankEntryKind =
  | "auto" | "expense" | "income" | "vendor_payment" | "customer_payment" | "journal";

/**
 * A BANK LINE'S ENTRY — AS THE STATEMENT READ IT, OR AS HE HAS CORRECTED IT.
 *
 * The direction used to be inferred from which column the parser filled, with
 * no way to argue. It is now an argument: `direction` overrides, and the
 * amount is always the magnitude, because an amount has no sign — the side
 * carries the meaning.
 *
 * `kind` only changes what the money is called and which document Zoho gets;
 * the two sides of the entry are the same double entry either way, which is
 * the point of showing it.
 */
export function bankEntry(p: {
  bank: string;
  account: string;
  debit: number;
  credit: number;
  /** Overrides the parsed columns. Absent = whichever column carries a figure. */
  direction?: "in" | "out" | null;
  kind?: BankEntryKind | null;
  /** The supplier or customer, for the two payment kinds. */
  party?: string | null;
}): Entry {
  const amount = r2(Math.abs(p.debit) || Math.abs(p.credit));
  const isOut = p.direction ? p.direction === "out" : r2(Math.abs(p.debit)) > 0;
  const kind = p.kind ?? "auto";
  const party = (p.party ?? "").trim();

  // For a supplier or customer payment the contra side is that party's own
  // control account, not a P&L head — paying a bill is not an expense, it
  // discharges one that was booked when the bill arrived.
  const head =
    kind === "vendor_payment" ? payableFor(party)
    : kind === "customer_payment" ? receivableFor(party)
    : (p.account || "— no ledger chosen —");

  const caveats: string[] = [];
  if (kind === "vendor_payment" && !party) caveats.push("Name the supplier — a vendor payment has to be against somebody.");
  if (kind === "customer_payment" && !party) caveats.push("Name the customer — a receipt has to be from somebody.");
  if (kind === "expense" && !isOut) caveats.push("An expense is money going out. This line is money coming in — book it as income, or turn the direction round.");
  if (kind === "income" && isOut) caveats.push("Income is money coming in. This line is money going out — book it as an expense, or turn the direction round.");
  // A PREVIEW MUST NOT PROMISE AN ENTRY THE POSTING WILL NOT MAKE.
  //
  // These two used to read as reassurance — "it books against the same head" —
  // and it does not. A vendor payment given money coming IN would have posted a
  // payment TO the supplier, the opposite entry, however this table drew it.
  // postBankLine refuses the combination now, and this says so in the same
  // words, so nothing is approved on the strength of a picture that will not
  // happen.
  if (kind === "vendor_payment" && !isOut) {
    caveats.push("This will not post. A vendor payment is money going OUT; this line is money coming IN, which looks like a refund from them — Zoho would record it as a payment TO them. Set this to Journal and pick the head the original cost went to.");
  }
  if (kind === "customer_payment" && isOut) {
    caveats.push("This will not post. A customer receipt is money coming IN; this line is money going OUT, which looks like a refund to them. Set this to Journal and pick the head it should come off.");
  }

  const outNote =
    kind === "vendor_payment" ? "clears what was owed to them"
    : kind === "expense" ? "what the money was spent on"
    : "what the money went to";
  const inNote =
    kind === "customer_payment" ? "clears what they owed"
    : kind === "income" ? "what was earned"
    : "what the money was for";

  return isOut
    ? finish([
        { account: head, side: "debit", amount, note: outNote },
        { account: p.bank, side: "credit", amount, note: "left the bank" },
      ], caveats)
    : finish([
        { account: p.bank, side: "debit", amount, note: "reached the bank" },
        { account: head, side: "credit", amount, note: inNote },
      ], caveats);
}

