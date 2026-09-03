// WHICH WAY THE MONEY WENT.
//
// His report, 3 September 2026:
//
//   "the amounts are showing negative sometimes positive, whereas the amount
//    should be positive… we got 6900 back from a person, the entry should be
//    bank account debit drawings, but it is showing drawings account debit to
//    Bank"
//
// Two real lines, both ₹6,900, both on 18 August 2026 in the NRO account,
// were stored as money OUT. The statement was a PDF, and its columns are
// rebuilt from where each number sits on the page, so a deposit printed a
// little to the left lands under Withdrawal. The balance beside each one had
// RISEN by exactly 6,900 — the file contradicted itself, and nothing looked.
//
// Answering "Drawings" on a line filed the wrong way produces
// *Drawings Dr / Bank Cr* on money that came in: the opposite entry, for real
// money, in his books.
//
//   node --experimental-strip-types tests/bankStatementDirection.test.ts

import { asMagnitudes, correctByBalance, rowsToLines, type StmtLine } from "../lib/bankStatementRows.ts";
import { bankEntry } from "../lib/entryShape.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// ── an amount is a magnitude; the side carries the meaning ──────────────────
check("a negative withdrawal is a deposit",
  JSON.stringify(asMagnitudes(-6900, 0)) === JSON.stringify({ debit: 0, credit: 6900 }),
  JSON.stringify(asMagnitudes(-6900, 0)));
check("a negative deposit is a withdrawal",
  JSON.stringify(asMagnitudes(0, -1500)) === JSON.stringify({ debit: 1500, credit: 0 }));
check("a positive withdrawal is left alone",
  JSON.stringify(asMagnitudes(503, 0)) === JSON.stringify({ debit: 503, credit: 0 }));
check("nothing ever comes back negative", (() => {
  for (const [d, c] of [[-1, 0], [0, -1], [-1, -1], [5, 0], [0, 5], [7, 3]] as [number, number][]) {
    const r = asMagnitudes(d, c);
    if (r.debit < 0 || r.credit < 0) return false;
  }
  return true;
})());
check("no line is a withdrawal and a deposit at once", (() => {
  const r = asMagnitudes(7, 3);
  return (r.debit === 0) !== (r.credit === 0);
})(), JSON.stringify(asMagnitudes(7, 3)));
check("paise survive", asMagnitudes(-53850.14, 0).credit === 53850.14);

// ── the real NRO lines, with their real balances ────────────────────────────
// Taken from bank_lines for statement c49aae1e…, rows 46–50 in file order.
// Rows 47 and 48 are the two he complained about: parsed as withdrawals, and
// the balance rises by 6,900 on each.
const nro: StmtLine[] = [
  { date: "2026-08-10", narration: "RTGS/HDFCR5202608/10946093/PAWAN KUMAR", ref: "", debit: 0, credit: 280000, balance: 1900753.58 },
  { date: "2026-08-18", narration: "NEFT/PUNBH26230923/131/SANGRUP BRANCH OF NIRC OF IC", ref: "", debit: 6900, credit: 0, balance: 1907653.58 },
  { date: "2026-08-18", narration: "IMPS/P2A/6230175805/9/BALDEVSI/PUNJAB NA/Transfer", ref: "", debit: 6900, credit: 0, balance: 1914553.58 },
  { date: "2026-09-01", narration: "NBSM/1490916291/HARYANA URBAN DEVELOPMENT AUTHORITY", ref: "", debit: 15000, credit: 0, balance: 1899553.58 },
  { date: "2026-09-01", narration: "NBSM/1490923991/HARYANA URBAN DEVELOPMENT AUTHORITY", ref: "", debit: 15000, credit: 0, balance: 1884553.58 },
];

const fixedNro = correctByBalance(nro, 1620753.58);
check("both ₹6,900 lines are turned round", fixedNro.fixed === 2, `fixed ${fixedNro.fixed}`);
check("the NIRC ₹6,900 becomes money IN",
  fixedNro.lines[1].credit === 6900 && fixedNro.lines[1].debit === 0,
  JSON.stringify(fixedNro.lines[1]));
check("the ₹6,900 returned by a person becomes money IN",
  fixedNro.lines[2].credit === 6900 && fixedNro.lines[2].debit === 0,
  JSON.stringify(fixedNro.lines[2]));
check("the two HUDA payments the same day are LEFT as money out",
  fixedNro.lines[3].debit === 15000 && fixedNro.lines[4].debit === 15000,
  "a correction that flips correct lines is worse than no correction");
check("a line already right is not touched",
  fixedNro.lines[0].credit === 280000 && fixedNro.lines[0].debit === 0);

// ── it must refuse to act on anything it cannot prove ───────────────────────
const noBalances: StmtLine[] = nro.map((l) => ({ ...l, balance: null }));
check("no balance column, no correction", correctByBalance(noBalances).fixed === 0,
  "a statement without balances must be left exactly as parsed");

const mismatched: StmtLine[] = [
  { date: "2026-01-01", narration: "a", ref: "", debit: 100, credit: 0, balance: 1000 },
  // The balance moved by 250 but the line says 100 — a row is missing between
  // them. Nothing here is provable, so nothing may be changed.
  { date: "2026-01-02", narration: "b", ref: "", debit: 100, credit: 0, balance: 1250 },
];
check("a balance change that is not this line's amount proves nothing",
  correctByBalance(mismatched, 1100).fixed === 0);

check("the first line is left alone when no opening balance is known",
  correctByBalance([{ date: "2026-01-01", narration: "a", ref: "", debit: 500, credit: 0, balance: 1000 }]).fixed === 0);
check("…and IS checked when the opening balance is known",
  correctByBalance([{ date: "2026-01-01", narration: "a", ref: "", debit: 500, credit: 0, balance: 1500 }], 1000).fixed === 1);

// ── a single signed amount column keeps its sign ────────────────────────────
// The bug that produced the wrong direction in the first place: Math.abs on a
// signed column made every line a withdrawal.
const signed = rowsToLines([
  ["Date", "Narration", "Amount", "Balance"],
  ["01/08/2026", "Paid the printer", "-2500.00", "97500.00"],
  ["02/08/2026", "Refund received", "6900.00", "104400.00"],
  ["03/08/2026", "Another payment", "-1000.00", "103400.00"],
]);
check("a signed amount column parses three lines", signed.lines.length === 3, signed.note);
check("negative in a signed column is money out",
  signed.lines[0].debit === 2500 && signed.lines[0].credit === 0,
  JSON.stringify(signed.lines[0]));
check("positive in a signed column is money in",
  signed.lines[1].credit === 6900 && signed.lines[1].debit === 0,
  JSON.stringify(signed.lines[1]));

// An UNSIGNED single column with no marker keeps the old behaviour — money out.
// (Two dated rows, because a header only counts as one when rows beneath it
//  actually parse as dates — see dateRowsUnder.)
const unsigned = rowsToLines([
  ["Date", "Particulars", "Amount", "Balance"],
  ["01/08/2026", "Paid the printer", "2500.00", "97500.00"],
  ["02/08/2026", "Paid the courier", "400.00", "97100.00"],
]);
check("an unsigned column with no marker is still money out",
  unsigned.lines[0]?.debit === 2500 && unsigned.lines[1]?.debit === 400,
  JSON.stringify(unsigned.lines));

// A Dr/Cr marker still beats the sign.
const marked = rowsToLines([
  ["Date", "Description", "Amount", "Transaction Type"],
  ["01/08/2026", "Card payment received", "12340.00", "Cr"],
  ["02/08/2026", "Restaurant", "-900.00", "Dr"],
]);
check("an explicit Cr marker wins", marked.lines[0]?.credit === 12340, JSON.stringify(marked.lines[0]));
check("an explicit Dr marker wins, and the figure stays positive",
  marked.lines[1]?.debit === 900, JSON.stringify(marked.lines[1]));

// Explicit Withdrawal/Deposit columns carrying a negative.
const negCol = rowsToLines([
  ["Txn Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
  ["18/08/2026", "Returned by a person", "-6900.00", "", "1914553.58"],
  ["01/09/2026", "Haryana Urban Development Authority", "15000.00", "", "1899553.58"],
]);
check("a negative in the withdrawal column is read as a deposit",
  negCol.lines[0]?.credit === 6900 && negCol.lines[0]?.debit === 0,
  JSON.stringify(negCol.lines[0]));
check("…and the ordinary withdrawal beside it is untouched",
  negCol.lines[1]?.debit === 15000 && negCol.lines[1]?.credit === 0,
  JSON.stringify(negCol.lines[1]));

/* ═══════════════════════════════════════════════════════════════════════════
   THE ENTRY THE DESK ACTUALLY GETS
   ═══════════════════════════════════════════════════════════════════════════

   The direction being right in the database is only half of it. What he saw
   was an ENTRY — "drawings account debit to Bank MAROO" — so the entry itself
   is checked here, including the overrides he asked for:

     "we should be able to generalise the entry on ourselves if your entry is
      incorrect. If something else has to be debited or something else has to
      be created."
*/
const dr = (e: { lines: { account: string; side: string; amount: number }[] }) =>
  e.lines.filter((l) => l.side === "debit").map((l) => `${l.account} ${l.amount}`).join(", ");
const cr = (e: { lines: { account: string; side: string; amount: number }[] }) =>
  e.lines.filter((l) => l.side === "credit").map((l) => `${l.account} ${l.amount}`).join(", ");

// His example, as it was: ₹6,900 back from a person, answered "Drawings".
const wrongWay = bankEntry({ bank: "Axis NRO", account: "Drawings", debit: 6900, credit: 0 });
check("the old shape — money read as OUT — debits Drawings and credits the bank",
  dr(wrongWay) === "Drawings 6900" && cr(wrongWay) === "Axis NRO 6900",
  "this is the entry he objected to; it is what a mis-read direction produces");

const rightWay = bankEntry({ bank: "Axis NRO", account: "Drawings", debit: 0, credit: 6900 });
check("read as money IN it debits the bank and credits Drawings",
  dr(rightWay) === "Axis NRO 6900" && cr(rightWay) === "Drawings 6900",
  `${dr(rightWay)} / ${cr(rightWay)}`);

// …and the override, which is the point: the row can stay as parsed and he
// turns the entry round himself.
const turned = bankEntry({ bank: "Axis NRO", account: "Drawings", debit: 6900, credit: 0, direction: "in" });
check("turning the direction round beats the parsed columns",
  dr(turned) === "Axis NRO 6900" && cr(turned) === "Drawings 6900",
  `${dr(turned)} / ${cr(turned)}`);

check("the figure is a magnitude whichever way it is turned",
  bankEntry({ bank: "B", account: "X", debit: -500, credit: 0 }).lines.every((l) => l.amount === 500));

// A vendor payment goes to the supplier's control account, not to a P&L head.
const vp = bankEntry({ bank: "Axis Current", account: "Printing", debit: 12000, credit: 0, kind: "vendor_payment", party: "Kwality Printers" });
check("a vendor payment debits the supplier, never the expense head",
  dr(vp).startsWith("Kwality Printers") && cr(vp) === "Axis Current 12000",
  `${dr(vp)} / ${cr(vp)}`);
check("…and it ignores the ledger box entirely", !dr(vp).includes("Printing"));

const cp = bankEntry({ bank: "Axis Current", account: "", debit: 0, credit: 50000, kind: "customer_payment", party: "Bikanervala" });
check("a customer receipt debits the bank and credits the customer",
  dr(cp) === "Axis Current 50000" && cr(cp).startsWith("Bikanervala"),
  `${dr(cp)} / ${cr(cp)}`);

check("a payment with nobody named says so rather than posting to nobody",
  bankEntry({ bank: "B", account: "", debit: 100, credit: 0, kind: "vendor_payment", party: "" }).caveats.length > 0);

check("an expense on money coming IN is objected to",
  bankEntry({ bank: "B", account: "Rent", debit: 0, credit: 100, kind: "expense" }).caveats.length > 0,
  "an expense is money going out; the desk should be told, not have it silently posted");
check("income on money going OUT is objected to",
  bankEntry({ bank: "B", account: "Fees", debit: 100, credit: 0, kind: "income" }).caveats.length > 0);

check("every entry balances", (() => {
  const cases = [wrongWay, rightWay, turned, vp, cp];
  return cases.every((e) => e.balanced && e.dr === e.cr);
})());

console.log(fails === 0 ? "ok — bank statement direction" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
