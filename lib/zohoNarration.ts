// WHAT THE LEDGER WILL SAY WHEN SOMEBODY READS IT IN TWO YEARS.
//
// A posting is not finished when the figures are right. Whoever opens Account
// Transactions — the auditor, the department, or him — sees ONE line of text
// against the amount, and that line is the line item's description. Not the
// bill's Notes field, which is detailed here but never appears in a ledger
// report; not the attachment, which is a click away. The description.
//
// So it carries, in one sentence and in this order, everything a reader needs
// in order to place the entry without opening anything else:
//
//   who — what · their document and its date · the foreign amount with the rate,
//   its source and the rule · the GST treatment · the withholding
//
// Nothing is invented: every clause disappears when the fact behind it is not
// known. A narration that guesses is worse than a short one.

const MAX = 480; // Zoho accepts more; a ledger column does not.

const s = (v: unknown) => String(v ?? "").trim();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "21 Jul 2026" — a date a person reads, not one they decode. */
export function readableDate(iso: string | null | undefined): string {
  const d = s(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

const money = (n: number | null | undefined) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";

/**
 * How the GST on this entry reads to somebody who did not post it.
 *
 * WHICH WAY THE TAX RUNS IS THE WHOLE POINT. On something we buy, the GST is
 * input credit we claim. On something we sell, exactly the same words would be
 * a false statement — it is output tax we have collected and owe. So the side
 * is asked for rather than assumed.
 */
export function gstClause(
  treatment: string | null | undefined,
  rate?: number | null,
  side: "purchase" | "sale" = "purchase",
  split?: string | null,
): string {
  const t = s(treatment).toLowerCase();
  const r = Number(rate) || 18;
  const heads = s(split) || "GST";
  if (!t) return "";
  if (t === "rcm" || t === "reverse" || t === "reverse_charge") {
    return `IGST ${r}% self-assessed under reverse charge (import of service)`;
  }
  if (t === "itc" || t === "charged" || t === "business_gst") {
    return side === "sale"
      ? `${heads} ${r}% charged — output tax collected and payable`
      : `${heads} ${r}% charged by the supplier — input credit claimed`;
  }
  if (t === "exempt") return "GST exempt";
  if (t === "zero") return "zero rated";
  if (t === "none" || t === "no") return "no GST";
  return "";
}

/**
 * How the withholding reads.
 *
 * Silence and "no TDS" are different statements, and the difference matters at
 * assessment: pass section: null to say nothing, pass a section with a zero rate
 * to say the desk considered it and none is due.
 */
export function tdsClause(p: {
  section?: string | null;
  rate?: number | null;
  amount?: number | null;
  mode?: string | null;
  /** "theirs" = withheld by our customer from what they pay us. */
  whose?: "ours" | "theirs";
}): string {
  const rate = Number(p.rate) || 0;
  if (!rate) return p.section === undefined ? "" : "no TDS";
  // "s.195 TDS" reads properly; with no section it is just "TDS", never "TDS TDS".
  const sec = s(p.section) ? `s.${s(p.section).replace(/^s\.?/i, "")} TDS` : "TDS";
  const amt = Number(p.amount) > 0 ? ` = ₹${money(p.amount)}` : "";
  if (p.whose === "theirs") {
    return `${sec} ${rate}%${amt} withheld by them — receivable until it appears in 26AS`;
  }
  const how = s(p.mode) === "gross_up"
    ? " (grossed up — borne by us, the vendor is paid in full)"
    : s(p.mode) === "deduct" ? " (deducted from the vendor)" : "";
  return `${sec} ${rate}%${amt}${how}`;
}

/**
 * The one line that goes on the ledger.
 *
 * Every part is optional and an empty part takes its separator with it, so a
 * domestic cash expense reads "Blinkit — Groceries · 12 Aug 2026" while an
 * imported service reads the whole sentence.
 */
export function lineNarration(p: {
  who?: string | null;
  what?: string | null;
  subAccount?: string | null;
  docNo?: string | null;
  docDate?: string | null;
  currency?: string | null;
  amount?: number | null;
  rate?: number | null;
  rateDate?: string | null;
  rateSource?: string | null;
  gst?: string | null;
  gstRate?: number | null;
  /** Purchase by default. A sale flips the tax from credit claimed to tax owed. */
  side?: "purchase" | "sale";
  /** "CGST+SGST" or "IGST" — the split the invoice actually carries. */
  gstSplit?: string | null;
  tds?: Parameters<typeof tdsClause>[0];
  /** "their invoice" by default; "our invoice", "receipt", "statement" as needed. */
  docLabel?: string;
  extra?: string | null;
}): string {
  const head = [s(p.who), s(p.what)].filter(Boolean).join(" — ")
    + (s(p.subAccount) ? ` (${s(p.subAccount)})` : "");

  const doc = s(p.docNo)
    ? `${p.docLabel ?? "their invoice"} ${s(p.docNo)}`
      + (readableDate(p.docDate) ? ` dated ${readableDate(p.docDate)}` : "")
    : readableDate(p.docDate);

  const cur = s(p.currency).toUpperCase();
  const foreign = cur && cur !== "INR" && Number.isFinite(Number(p.amount))
    ? `${cur} ${money(p.amount)}`
      + (Number(p.rate)
        ? ` @ ₹${money(p.rate)}`
          + (s(p.rateSource) || readableDate(p.rateDate)
            ? ` (${[s(p.rateSource), readableDate(p.rateDate)].filter(Boolean).join(" ")}, Rule 115)`
            : " (Rule 115)")
        : "")
    : "";

  return [head, doc, foreign, gstClause(p.gst, p.gstRate, p.side ?? "purchase", p.gstSplit), p.tds ? tdsClause(p.tds) : "", s(p.extra)]
    .map((x) => s(x))
    .filter(Boolean)
    .join(" · ")
    .slice(0, MAX);
}
