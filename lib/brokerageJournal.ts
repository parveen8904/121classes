import { lineNarration } from "@/lib/zohoNarration";

// THE ENTRY THE NOTE WILL BECOME — WORKED OUT IN ONE PLACE.
//
// He asked, before approving: what exactly goes into Zoho? A fair question that
// the desk could not answer, because the entry was built inside the approval
// itself. Whatever was shown beforehand would have been a second implementation
// of it, free to drift, and a preview that can drift is worse than none.
//
// So it is built here and nowhere else. The page shows what this returns, the
// download prints what this returns, and the approval posts what this returns.
// The three cannot disagree.

export type JournalLine = {
  account: string;
  side: "debit" | "credit";
  amount: number;
  note: string;
  nature: string;
  operating: string;
};

export type BuiltJournal = { lines: JournalLine[]; narration: string; net: number };

/** Each head of the note, and the ledger it belongs in. */
export const HEADS: { key: string; account: string; label: string; nature: string; operating: string }[] = [
  { key: "cashDividends", account: "Dividend-US", label: "Cash dividends", nature: "income", operating: "non_operating" },
  { key: "manufacturedDividends", account: "Manufactured Dividend-US", label: "Manufactured / substitute dividends", nature: "income", operating: "non_operating" },
  { key: "stockLending", account: "Stock Lending Income-US", label: "Stock lending income", nature: "income", operating: "non_operating" },
  { key: "interest", account: "Interest Income", label: "Interest on idle cash", nature: "income", operating: "non_operating" },
  { key: "options", account: "Option Premium-US", label: "Net option premium", nature: "income", operating: "non_operating" },
  { key: "equityRealised", account: "Capital Gain-US", label: "Realised gain on equity (FIFO)", nature: "income", operating: "non_operating" },
  { key: "marginInterest", account: "Interest Paid-US", label: "Margin interest paid", nature: "expense", operating: "non_operating" },
  { key: "fees", account: "US Bank Charges", label: "Fees", nature: "expense", operating: "non_operating" },
];

type NoteRow = {
  account_name: string;
  period_start: string;
  period_end: string;
  workbook: { partial?: boolean; inrByHead?: Record<string, number> } | null;
};

/**
 * The journal for a note, in rupees.
 *
 * Each head was converted at the Rule 115 rate of its own transactions when the
 * note was built, so the entry carries those figures rather than re-converting
 * one total at one rate. A head that came out negative is simply the other way
 * round — income that turned out to be a cost is a debit, and the sign is never
 * dropped to make it look like the other thing.
 */
export function journalFromWorkingNote(n: NoteRow): BuiltJournal {
  const inr = n.workbook?.inrByHead ?? {};
  const lines: JournalLine[] = [];
  let net = 0;

  for (const h of HEADS) {
    const v = Number(inr[h.key] ?? 0);
    if (Math.abs(v) < 0.5) continue;
    const side: "debit" | "credit" = v > 0 ? "credit" : "debit";
    lines.push({
      account: h.account,
      side,
      amount: Number(Math.abs(v).toFixed(2)),
      note: lineNarration({
        who: n.account_name,
        what: h.label,
        docDate: n.period_end,
        extra: `${n.period_start} to ${n.period_end}, each transaction at the Rule 115 rate of its own date`,
      }),
      nature: v > 0 ? "income" : "expense",
      operating: "non_operating",
    });
    net += v;
  }

  // The other side: what the account itself is worth more, or less, by.
  if (Math.abs(net) > 0.5) {
    lines.push({
      account: n.account_name,
      side: net > 0 ? "debit" : "credit",
      amount: Number(Math.abs(net).toFixed(2)),
      note: lineNarration({
        who: n.account_name,
        what: "movement in the brokerage account for the period",
        docDate: n.period_end,
        extra: `${n.period_start} to ${n.period_end}`,
      }),
      nature: "asset",
      operating: "operating",
    });
  }

  return {
    lines,
    narration: `${n.account_name} — ${n.period_start} to ${n.period_end}, from the approved working note`,
    net: Number(net.toFixed(2)),
  };
}
