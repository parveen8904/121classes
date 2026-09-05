// An Axis CREDIT-CARD statement must file, not die at the header.
//
// Uploaded 3 September 2026: it reached the vault, 32 rows were read off the
// PDF cleanly, and then it reported that it could not be parsed. Both reasons
// are here.
import { parseIndianDate, num, rowsToLines, detectDateStyle, parsePartialDate } from "../lib/bankStatementRows.ts";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};

/* ── 1. the year written with an apostrophe ──────────────────────────────── */

check("a card's apostrophe year parses", parseIndianDate("18 Jul '26") === "2026-07-18",
  "it returned \"\", and an empty date is how a whole statement dies quietly");
check("…the typographic apostrophe too", parseIndianDate("21 Jun ’26") === "2026-06-21",
  "a PDF usually carries the curly one");
check("the formats that already worked still do",
  parseIndianDate("18 Jul 26") === "2026-07-18" &&
  parseIndianDate("18-07-2026") === "2026-07-18" &&
  parseIndianDate("2026-07-18") === "2026-07-18" &&
  parseIndianDate("18/07/26") === "2026-07-18");
check("a line that is not a date is still not a date",
  parseIndianDate("Total") === "" && parseIndianDate("") === "");

/* ── 2. one amount column, direction in its own ──────────────────────────── */

// Exactly the header and shape the card produced.
const card = [
  ["Date", "Transaction Details", "Amount (INR)", "Debit/Credit"],
  ["18 Jul '26", "Foreign Currency Transaction Fee", "₹59.89", "Debit"],
  ["10 Jul '26", "ANTHROPIC* CLAUDE SUB,ANTHROPIC.COM", "₹11,281.07", "Debit"],
  ["08 Jul '26", "Payment Received", "₹11,940.61", "Credit"],
];
const out = rowsToLines(card);
check("every line files", out.lines.length === 3,
  `got ${out.lines.length}: ${out.note}`);
check("a spend is money out",
  out.lines[0]?.debit === 59.89 && out.lines[0]?.credit === 0);
check("the rupee sign and the comma are read through",
  out.lines[1]?.debit === 11281.07);
check("a payment received is money IN, not another spend",
  out.lines[2]?.credit === 11940.61 && out.lines[2]?.debit === 0,
  "on a card a credit reduces what is owed");
check("nothing is filed with a sign",
  out.lines.every((l) => l.debit >= 0 && l.credit >= 0));

/* ── 3. the same header, spelt loosely enough to need the second pass ────── */

// "Debit / Credit" answers to the debit pattern AND the credit pattern, so it
// was recorded as both amount columns; num("Debit") is 0, so every row came
// out empty on both sides and was dropped.
const loose = rowsToLines([
  ["Date", "Txn Details", "Amount in INR", "Debit / Credit"],
  ["18 Jul '26", "Some spend", "₹100.00", "Debit"],
  ["19 Jul '26", "Refund", "₹40.00", "Credit"],
]);
check("a loosely-named direction column does not eat both amount columns",
  loose.lines.length === 2, `got ${loose.lines.length}: ${loose.note}`);
check("…and it still knows which way each line goes",
  loose.lines[0]?.debit === 100 && loose.lines[1]?.credit === 40);

/* ── a bank statement with real Debit/Credit AMOUNT columns is untouched ─── */

const bank = rowsToLines([
  ["Tran Date", "Particulars", "Debit", "Credit", "Balance"],
  ["18/07/2026", "NEFT out", "500.00", "", "1,500.00"],
  ["19/07/2026", "NEFT in", "", "250.00", "1,750.00"],
]);
check("two separate amount columns still work",
  bank.lines.length === 2 && bank.lines[0]?.debit === 500 && bank.lines[1]?.credit === 250,
  "the new rule must only fire when ONE column answers to both");

/* ── a US card prints dollars, and the sign sits outside the symbol ──────── */

check("a dollar amount is a number", num("$37.32") === 37.32,
  "his Citi Costco statement came through as six rows of zero: Number(\"$37.32\") is NaN");
check("a negative dollar keeps its minus", num("-$190.32") === -190.32,
  "stripping the $ must not eat the sign — that payment would become a spend");
check("the formats that already worked are untouched",
  num("₹2,231.38") === 2231.38 && num("INR 86,493.00") === 86493 &&
  num("1,234.56 Cr") === 1234.56 && num("(500.00)") === -500);
check("nonsense is still zero, not NaN", num("abc") === 0 && num("") === 0);

/* ── a US card: no year on the row, month first, purchases positive ─────── */

// Read off his real Citi Costco April 2026 statement.
const citiText = "APRIL STATEMENT Billing Period: 03/28/26-04/28/26 New balance as of 04/28/26: $163.73";
const style = detectDateStyle(citiText);
check("the billing period is read off the statement",
  style?.order === "mdy" && style?.fromISO === "2026-03-28" && style?.toISO === "2026-04-28",
  "28 cannot be a month, so the statement names its own order and years");
check("an Indian period is read as day-first",
  detectDateStyle("Statement period 28/03/2026 - 28/04/2026")?.order === "dmy");
check("a genuinely ambiguous period is refused, not guessed",
  detectDateStyle("Period 03/04/26-05/06/26") === null,
  "every component is 12 or less; picking one would be a coin toss on his books");
check("no period at all means no style", detectDateStyle("no dates here") === null);

check("a bare 04/02 becomes 2 April, not 4 February",
  parsePartialDate("04/02", style) === "2026-04-02",
  "the wrong order is a silently wrong date, which nothing downstream can catch");
check("a bare date without a style is refused", parsePartialDate("04/02", null) === "");
check("a year boundary picks the year that fits the period", (() => {
  const st = detectDateStyle("Billing Period: 12/28/25-01/28/26");
  return parsePartialDate("12/30", st) === "2025-12-30" && parsePartialDate("01/05", st) === "2026-01-05";
})(), "one statement, two years");

const citi = rowsToLines([
  ["Sale Date", "Post Date", "Description", "Amount"],
  ["04/20", "", "AUTOPAY 240628111816416RAUTOPAY AUTO-PMT", "-$190.32"],
  ["04/02", "04/02", "SINCH MAILGUN MAILGUN.COM TX", "$37.32"],
  ["04/24", "04/24", "COSTCO GAS #1173 FORT WORTH TX", "$18.08"],
  ["04/25", "04/25", "COSERV ELECTRIC NRC4.COSERV.CTX", "$74.00"],
  ["04/25", "04/25", "COSTCO GAS #1173 FORT WORTH TX", "$34.33"],
], { style, accountKind: "credit_card" });

check("every row of the Citi statement files", citi.lines.length === 5,
  `got ${citi.lines.length}: ${citi.note}`);
check("a purchase on a card is money OUT even though it is printed positive",
  citi.lines.find((l) => /MAILGUN/.test(l.narration))?.debit === 37.32);
check("the autopay is money IN even though it is printed negative",
  citi.lines.find((l) => /AUTOPAY/.test(l.narration))?.credit === 190.32,
  "the bank rule would have filed the whole card backwards");
check("the spends add up to the balance the statement itself prints",
  Math.round(citi.lines.reduce((a, l) => a + l.debit, 0) * 100) === 16373,
  "$163.73 — the statement's own \"New balance as of 04/28/26\"");

// The bank rule must survive: on a bank export a minus IS money leaving.
const bankSigned = rowsToLines([
  ["Date", "Narration", "Amount"],
  ["18/07/2026", "NEFT out", "-500.00"],
  ["19/07/2026", "NEFT in", "250.00"],
], { accountKind: "bank" });
check("a signed BANK column still reads a minus as money out",
  bankSigned.lines[0]?.debit === 500 && bankSigned.lines[1]?.credit === 250,
  "the card rule must fire only for a credit-card account");

/* ── a statement with ONE transaction on it ─────────────────────────────── */

// His Axis 4812 statement, exactly as the vault read it: a header and one line.
const single = rowsToLines([
  ["Date", "Transaction Details", "Amount (INR)", "Debit/Credit"],
  ["07 Apr '26", "Payment Received", "₹ 3,540.00", "Credit"],
], { accountKind: "credit_card" });

check("a one-line statement is read", single.lines.length === 1,
  `got ${single.lines.length}: ${single.note.slice(0, 90)}`);
check("…and the payment is money IN",
  single.lines[0]?.credit === 3540 && single.lines[0]?.debit === 0,
  "a payment on a card reduces what is owed");
check("the date with an apostrophe still parses here", single.lines[0]?.date === "2026-04-07");
check("a rupee sign with a SPACE after it is read through",
  single.lines[0]?.credit === 3540, '"₹ 3,540.00" — the space is real in his file');

check("the header still has to prove itself where there ARE rows to ask", (() => {
  // Five rows beneath, none of them dated: this is a preamble, not a table.
  const decoy = rowsToLines([
    ["Date", "Particulars", "Amount"],
    ["Account holder", "PARVEEN SHARMA", ""],
    ["Address", "B-173 Nirman Vihar", ""],
    ["Branch", "Nirman Vihar", ""],
    ["IFSC", "UTIB0000234", ""],
    ["Customer ID", "912345678", ""],
  ]);
  return decoy.lines.length === 0;
})(), "the two-date rule earns its keep and must not be lost to this");

check("blank spacing rows do not count against 'all of them parsed'", (() => {
  const spaced = rowsToLines([
    ["Date", "Transaction Details", "Amount (INR)", "Debit/Credit"],
    ["", "", "", ""],
    ["07 Apr '26", "Payment Received", "₹ 3,540.00", "Credit"],
  ], { accountKind: "credit_card" });
  return spaced.lines.length === 1;
})());

console.log(fails ? `${fails} failed` : "ok — a credit-card statement files");
process.exit(fails ? 1 : 0);
