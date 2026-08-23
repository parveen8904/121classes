import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import type { WorkingNote, RateUsed, Detail } from "@/lib/brokerageWorkbook";
import { journalFromWorkingNote } from "@/lib/brokerageJournal";

// THE WORKING NOTE, AS A FILE HE CAN HAND TO ANYBODY.
//
// The specimen he sent set the shape and this follows it row for row: A capital
// gains on equity, B options on premium, C investment income, D charges, then
// the net result — PARTICULARS, USD, ₹ (Rule 115). A working note that lives
// only inside a web page is no use to him at assessment; this is the same note
// as a workbook, with the detail behind every figure on its own sheet.
//
// The sheet that matters most after the note itself is RATES APPLIED. Rule 115
// converts each receipt at the rate for ITS OWN date, so "the rate we used" is
// never one number — it is one per date per head. Listed in full, anybody can
// re-perform any line of the note without asking us anything.

export const dynamic = "force-dynamic";

type Note = WorkingNote & {
  inrByHead?: Record<string, number>;
  ratesUsed?: RateUsed[];
  ratesMissing?: string[];
};

const HEAD_LABEL: Record<string, string> = {
  equityRealised: "A · Equity — realised gain / (loss)",
  options: "B · Options — net premium",
  cashDividends: "C · Cash dividends",
  manufacturedDividends: "C · Manufactured / substitute dividends",
  stockLending: "C · Stock lending income",
  interest: "C · Interest on idle cash",
  marginInterest: "D · Margin interest paid",
  fees: "D · Fees",
};

const n2 = (v: number | null | undefined) =>
  Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : null;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await assertArea("zoho");
  const { id } = await ctx.params;

  const svc = createServiceClient();
  const { data: row } = await svc
    .from("brokerage_notes")
    .select("account_name, period_start, period_end, workbook, status, note")
    .eq("id", id)
    .maybeSingle();

  if (!row?.workbook) {
    return NextResponse.json({ error: "that working note could not be found" }, { status: 404 });
  }
  const w = row.workbook as unknown as Note;
  const inr = w.inrByHead ?? {};

  const wb = XLSX.utils.book_new();

  /* ── 1 · The note itself, in the specimen's own order ──────────────────── */
  const R = (particulars: string, usd?: number | null, head?: string) => [
    particulars,
    usd === undefined || usd === null ? null : n2(usd),
    head && inr[head] !== undefined ? n2(inr[head]) : null,
  ];
  const blank = ["", null, null];

  const note: (string | number | null)[][] = [
    [`${row.account_name} — investment working note`],
    [`Period ${row.period_start} to ${row.period_end}`],
    ["Converted under Rule 115 of the Income-tax Rules — each receipt at the telegraphic transfer buying rate of its own date, never a period average. Every rate used is listed on the 'Rates applied' sheet."],
    row.status === "draft" ? ["DRAFT — not yet approved, nothing journalled"] : [`Status: ${row.status}`],
    blank,
    ["PARTICULARS", "USD", "₹ (Rule 115)"],
    blank,
    ["A · CAPITAL GAINS — EQUITY / ETF"],
    R("Realised gain / (loss) — FIFO, cost carried from date of purchase", w.equity.realisedFifo, "equityRealised"),
    R("Sale proceeds of shares with no recorded purchase cost", w.equity.uncostedProceeds),
    R("Less: cost of those shares", w.equity.uncostedCost ?? 0),
    R(`Sub-total — equity${w.partial ? " (EXCLUDES the uncosted sales)" : ""}`, w.equity.subTotal),
    blank,
    ["B · CAPITAL GAINS — OPTIONS (premium / cash basis)"],
    R("Net premium realised on options", w.options.net, "options"),
    blank,
    ["C · INVESTMENT INCOME"],
    R("Cash dividends (CDIV)", w.income.cashDividends, "cashDividends"),
    R("Manufactured / substitute dividends (MDIV) — ordinary income, no treaty dividend rate", w.income.manufacturedDividends, "manufacturedDividends"),
    R("Stock lending income (SLIP)", w.income.stockLending, "stockLending"),
    R("Interest on idle cash (INT)", w.income.interest, "interest"),
    R("Sub-total — investment income", w.income.subTotal),
    blank,
    ["D · EXPENSES / CHARGES"],
    R("Margin interest paid, net of credits (MINT)", w.charges.marginInterest, "marginInterest"),
    R("Fees", w.charges.fees, "fees"),
    R("Sub-total — charges", w.charges.subTotal),
    blank,
    R(`NET RESULT FOR THE PERIOD${w.partial ? " — PARTIAL" : ""}`, w.netResult),
  ];

  if (w.partial) {
    note.push(blank, ["Sales with no purchase cost in the file are excluded from the equity sub-total and from the net result. Proceeds without a cost are not a gain, and showing them as one would overstate the income. Their detail is on the 'Uncosted sales' sheet."]);
  }
  if (w.excluded?.length) {
    note.push(blank, ["EXCLUDED AS CAPITAL / NON-INCOME MOVEMENTS — listed so the note reconciles to the account, not dropped"]);
    for (const e of w.excluded) note.push(R(e.label, e.amount));
  }
  const sameDay = (w.equity.scrips ?? []).filter((sc) => sc.sameDayRoundTrip).map((sc) => sc.scrip);
  if (sameDay.length) {
    note.push(blank, [`Bought and sold on the same day, where the file carries no execution times, so which fill came first is an assumption: ${sameDay.join(", ")}.`]);
  }
  if (w.ratesMissing?.length) {
    note.push(blank, [`No Rule 115 rate was available for ${w.ratesMissing.length} date(s): ${w.ratesMissing.join(", ")}. Those transactions carry no rupee figure — they are NOT converted at a neighbouring day's rate.`]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(note);
  sheet["!cols"] = [{ wch: 78 }, { wch: 16 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Working note");

  /* ── 2 · Every rate the note stands on ─────────────────────────────────── */
  const rates = (w.ratesUsed ?? []).map((r) => ({
    Head: HEAD_LABEL[r.head] ?? r.head,
    Date: r.date,
    "Rule 115 rate (₹/USD)": n2(r.rate),
    "Transactions": r.count,
    "USD converted": n2(r.usd),
    "₹": n2(r.inr),
  }));
  const rateSheet = XLSX.utils.json_to_sheet(
    rates.length ? rates : [{ Head: "No rate was recorded for this note — it was built before the rates were kept, or none was available." }],
  );
  rateSheet["!cols"] = [{ wch: 44 }, { wch: 12 }, { wch: 20 }, { wch: 13 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, rateSheet, "Rates applied");

  /* ── 3 · The entry it becomes, so the note can be approved on paper ────── */
  const j = journalFromWorkingNote({
    account_name: String(row.account_name), period_start: String(row.period_start),
    period_end: String(row.period_end), workbook: w as never,
  });
  if (j.lines.length >= 2) {
    const jr: (string | number | null)[][] = [
      [row.status === "draft"
        ? "PROPOSED JOURNAL ENTRY — not yet approved, nothing is in Zoho"
        : "JOURNAL ENTRY AS POSTED"],
      [`Dated ${row.period_end} · ${j.narration}`],
      [],
      ["Ledger", "Debit ₹", "Credit ₹", "Narration"],
    ];
    for (const l of j.lines) {
      jr.push([l.account, l.side === "debit" ? n2(l.amount) : null, l.side === "credit" ? n2(l.amount) : null, l.note]);
    }
    jr.push([
      "Total",
      n2(j.lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0)),
      n2(j.lines.filter((l) => l.side === "credit").reduce((t, l) => t + l.amount, 0)),
      "",
    ]);
    const jsheet = XLSX.utils.aoa_to_sheet(jr);
    jsheet["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, jsheet, "Journal entry");
  }

  /* ── 4 · The detail behind each figure ─────────────────────────────────── */
  const add = (name: string, rows: Record<string, unknown>[], cols?: number[]) => {
    if (!rows.length) return;
    const sh = XLSX.utils.json_to_sheet(rows);
    if (cols) sh["!cols"] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, sh, name.slice(0, 31));
  };

  add("Equity trades (FIFO)", (w.equity.trades ?? []).map((t) => ({
    Scrip: t.scrip, "Sold on": t.saleDate, "Bought on": t.purchaseDate, Lot: t.lot,
    Quantity: t.qty, "Proceeds USD": n2(t.proceeds), "Cost USD": n2(t.cost), "Gain / (loss) USD": n2(t.pl),
  })), [12, 12, 12, 16, 12, 15, 14, 18]);

  add("Scrip summary", (w.equity.scrips ?? []).map((sc) => ({
    Scrip: sc.scrip, "Bought qty": sc.buyQty, "Bought USD": n2(sc.buyValue),
    "Sold qty": sc.sellQty, "Sold USD": n2(sc.sellValue),
    "Matched qty": sc.matchedQty, "Matched proceeds": n2(sc.matchedProceeds), "Matched cost": n2(sc.matchedCost),
    "Realised USD": n2(sc.realised),
    "Sold from opening holding": sc.soldFromOpening ? "yes" : "",
    "Same-day round trip": sc.sameDayRoundTrip ? "yes — order of fills assumed" : "",
  })), [12, 12, 14, 11, 14, 12, 17, 14, 14, 24, 28]);

  add("Uncosted sales", (w.equity.opening ?? []).map((o) => ({
    Scrip: o.scrip, "Quantity sold": o.qtySold, "Proceeds USD": n2(o.proceeds), "Average price USD": n2(o.avgPrice),
    "Cost": w.equity.uncostedCost === null ? "not yet given" : "included in the note",
  })), [12, 14, 15, 18, 22]);

  add("Options", (w.options.rows ?? []).map((o) => ({
    Underlying: o.underlying, Contracts: o.contracts,
    "STO (premium received)": n2(o.sto), "BTC (paid to close)": n2(o.btc),
    "BTO (premium paid)": n2(o.bto), "STC (received on close)": n2(o.stc),
    "Net USD": n2(o.net),
  })), [14, 11, 22, 20, 20, 23, 12]);

  for (const [head, rows] of Object.entries(w.income.detail ?? {})) {
    add(`Income — ${head}`, (rows as Detail[]).map((d) => ({
      Date: d.date, Scrip: d.scrip, Description: d.description, "USD": n2(d.amount),
    })), [12, 12, 60, 14]);
  }

  add("Charges", (w.charges.detail ?? []).map((d) => ({
    Date: d.date, Scrip: d.scrip, Description: d.description, "USD": n2(d.amount),
  })), [12, 12, 60, 14]);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const file = `${String(row.account_name).replace(/[^\w.-]+/g, "-")}-working-note-${row.period_start}-to-${row.period_end}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
