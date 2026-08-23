import { createServiceClient } from "@/lib/supabase/service";

// THE BROKERAGE WORKING NOTE — HIS OWN METHOD, PUT BACK.
//
// A brokerage CSV is not journalled line by line. It is first summarised into
// what actually happened over the period, and the summary is what a person can
// check: interest received, dividends received, charges paid, option premium
// paid and received, what shares cost, what they fetched — and the gain or loss
// falls out of that. Every figure is converted at its own Rule-115 rate,
// transaction by transaction, never at a period average.
//
// Two things this gets right that a line-by-line posting cannot:
//
//   AN ASSIGNED OPTION IS PART OF THE SALE. When a written call is assigned the
//   shares go at the strike, but the premium already received is part of what
//   was got for them. Leaving it in "premium received" understates the sale and
//   the gain; the note carries it into the proceeds and says it has.
//
//   A FIGURE MUST LEAD BACK TO ITS TRANSACTIONS. Every bucket keeps the lines
//   behind it, so any total can be opened and checked rather than believed.

export type Bucket = {
  label: string;
  usd: number;
  inr: number;
  count: number;
  lines: { date: string; symbol: string | null; usd: number; inr: number; rate: number | null; note: string }[];
};

export type Note = {
  account: string;
  from: string;
  to: string;
  buckets: Record<string, Bucket>;
  gainInr: number;
  lossInr: number;
  unpricedSells: number;      // sells still without their rupee cost
};

const BUCKETS: { key: string; label: string }[] = [
  { key: "interest",         label: "Interest received" },
  { key: "dividend",         label: "Dividends received" },
  { key: "charges",          label: "Charges paid" },
  { key: "tax_withheld",     label: "Tax withheld at source" },
  { key: "premium_received", label: "Option premium received" },
  { key: "premium_paid",     label: "Option premium paid" },
  { key: "shares_cost",      label: "Cost of shares bought" },
  { key: "shares_proceeds",  label: "Sale proceeds of shares" },
];

const empty = (label: string): Bucket => ({ label, usd: 0, inr: 0, count: 0, lines: [] });

/** Is this line an option rather than the share itself? */
const looksLikeOption = (symbol: string | null, description: string | null) =>
  /\b(call|put)\b|\d{6}[CP]\d|\bopt\b/i.test(`${symbol ?? ""} ${description ?? ""}`);

/** Was a written option assigned — i.e. did it become a share sale? */
const looksAssigned = (description: string | null) => /assign|exercis/i.test(description ?? "");

/**
 * Build the note for a period from the lines already parsed and converted.
 * Reads only; nothing is written to Zoho and nothing is journalled.
 */
export async function buildNote(accountName: string, from: string, to: string): Promise<Note> {
  const svc = createServiceClient();
  const { data: rows } = await svc.from("brokerage_lines")
    .select("line_date, kind, symbol, usd_amount, inr_amount, rate, description, cost_inr, proposal")
    .eq("account_name", accountName)
    .gte("line_date", from).lte("line_date", to)
    .neq("status", "skipped")
    .order("line_date");

  const buckets: Record<string, Bucket> = {};
  for (const b of BUCKETS) buckets[b.key] = empty(b.label);

  let gainInr = 0, lossInr = 0, unpricedSells = 0;
  let assignedPremium = 0;                       // premium carried into proceeds

  for (const r of rows ?? []) {
    const usd = Math.abs(Number(r.usd_amount) || 0);
    const inr = Math.abs(Number(r.inr_amount) || 0);
    const isOption = looksLikeOption(r.symbol as string | null, r.description as string | null);
    const line = {
      date: String(r.line_date), symbol: (r.symbol as string | null) ?? null,
      usd, inr, rate: r.rate === null ? null : Number(r.rate),
      note: String(r.description ?? "").slice(0, 120),
    };
    const put = (key: string) => {
      const b = buckets[key];
      b.usd += usd; b.inr += inr; b.count += 1; b.lines.push(line);
    };

    switch (String(r.kind)) {
      case "interest": put("interest"); break;
      case "dividend": put("dividend"); break;
      case "fee": put("charges"); break;
      case "tax": put("tax_withheld"); break;

      case "buy":
        if (isOption) put("premium_paid"); else put("shares_cost");
        break;

      case "sell": {
        if (isOption && !looksAssigned(r.description as string | null)) {
          put("premium_received");
          break;
        }
        // A share sale — or an assigned option, which IS part of a share sale.
        put("shares_proceeds");
        if (isOption) {
          // PREMIUM ON AN ASSIGNED CALL HAS NO COST. It was received for writing
          // the option, not paid for anything, so it is proceeds in full — and
          // asking for a cost on it would be asking for a figure that does not
          // exist. The shares themselves carry the cost, on their own line.
          assignedPremium += inr;
          break;
        }

        // The gain needs the rupee cost of what was sold, which is asked per
        // sale. Without it the note says so rather than inventing one.
        const cost = r.cost_inr === null || r.cost_inr === undefined ? null : Number(r.cost_inr);
        if (cost === null) { unpricedSells += 1; break; }
        const result = inr - cost;
        if (result >= 0) gainInr += result; else lossInr += Math.abs(result);
        break;
      }
      default: break;
    }
  }

  // Premium on assigned options belongs to the proceeds, and is shown there.
  if (assignedPremium > 0) {
    buckets.shares_proceeds.lines.push({
      date: to, symbol: null, usd: 0, inr: 0, rate: null,
      note: `includes ₹${Math.round(assignedPremium).toLocaleString("en-IN")} of premium on options that were assigned`,
    });
  }

  return {
    account: accountName, from, to, buckets,
    gainInr: Number(gainInr.toFixed(2)), lossInr: Number(lossInr.toFixed(2)), unpricedSells,
  };
}

/** Save (or refresh) the note for a period. Never touches an approved one. */
export async function saveNote(accountName: string, from: string, to: string): Promise<{ id: string; note: Note } | null> {
  const svc = createServiceClient();
  const note = await buildNote(accountName, from, to);
  const anything = Object.values(note.buckets).some((b) => b.count > 0);
  if (!anything) return null;

  const { data: existing } = await svc.from("brokerage_notes")
    .select("id, status").eq("account_name", accountName)
    .eq("period_start", from).eq("period_end", to).maybeSingle();
  if (existing && existing.status !== "draft") return { id: existing.id, note };

  const row = {
    account_name: accountName, period_start: from, period_end: to,
    buckets: note.buckets as unknown as Record<string, unknown>,
    gain_inr: note.gainInr, loss_inr: note.lossInr,
    note: note.unpricedSells
      ? `${note.unpricedSells} sale(s) still need their rupee cost before the gain is complete.`
      : null,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await svc.from("brokerage_notes").update(row).eq("id", existing.id);
    return { id: existing.id, note };
  }
  const { data: made } = await svc.from("brokerage_notes").insert(row).select("id").single();
  return made ? { id: made.id, note } : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE JOURNAL, FROM THE NOTE HE APPROVED
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which ledger each bucket goes to, and which way. */
const POSTING: Record<string, { account: string; side: "debit" | "credit"; nature: string; operating: string }> = {
  interest:         { account: "Interest Income",        side: "credit", nature: "income",  operating: "non_operating" },
  dividend:         { account: "Dividend-US",            side: "credit", nature: "income",  operating: "non_operating" },
  charges:          { account: "US Bank Charges",        side: "debit",  nature: "expense", operating: "non_operating" },
  tax_withheld:     { account: "US Tax Expenses",        side: "debit",  nature: "expense", operating: "non_operating" },
  premium_received: { account: "Option Premium Received", side: "credit", nature: "income",  operating: "non_operating" },
  premium_paid:     { account: "Option Premium Paid",     side: "debit",  nature: "expense", operating: "non_operating" },
};

/**
 * Turn an approved note into one balanced journal.
 *
 * The brokerage account itself takes the other side of every line, because that
 * is where the money actually moved. Share purchases and sales are NOT put
 * through here — they move the holding rather than the result, and each sale
 * needs its own cost — so the note carries them and the journal carries the
 * income, the charges and the realised gain.
 */
export function journalFromNote(note: Note, brokerageAccount: string): {
  lines: { account: string; side: "debit" | "credit"; amount: number; note: string; nature: string; operating: string }[];
  narration: string;
} {
  const lines: { account: string; side: "debit" | "credit"; amount: number; note: string; nature: string; operating: string }[] = [];
  let net = 0;                                   // what the brokerage account moved by

  for (const [key, posting] of Object.entries(POSTING)) {
    const b = note.buckets[key];
    if (!b || b.inr <= 0) continue;
    lines.push({
      account: posting.account, side: posting.side, amount: Number(b.inr.toFixed(2)),
      note: `${b.label} — ${b.count} transaction${b.count === 1 ? "" : "s"} at their Rule-115 rates`,
      nature: posting.nature, operating: posting.operating,
    });
    net += posting.side === "credit" ? b.inr : -b.inr;
  }

  if (note.gainInr > 0) {
    lines.push({ account: "Capital Gain-US", side: "credit", amount: Number(note.gainInr.toFixed(2)),
      note: "realised gain on shares sold", nature: "income", operating: "non_operating" });
  }
  if (note.lossInr > 0) {
    lines.push({ account: "Capital Loss-US", side: "debit", amount: Number(note.lossInr.toFixed(2)),
      note: "realised loss on shares sold", nature: "expense", operating: "non_operating" });
  }
  net += note.gainInr - note.lossInr;

  if (Math.abs(net) > 0.005) {
    lines.push({
      account: brokerageAccount,
      side: net > 0 ? "debit" : "credit",
      amount: Number(Math.abs(net).toFixed(2)),
      note: "the movement in the brokerage account",
      nature: "asset", operating: "operating",
    });
  }

  return {
    lines,
    narration: `${note.account} — ${note.from} to ${note.to}: interest, dividends, charges and realised gains, each converted at its own Rule-115 rate`,
  };
}
