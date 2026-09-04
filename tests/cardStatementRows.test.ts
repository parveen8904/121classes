// An Axis CREDIT-CARD statement must file, not die at the header.
//
// Uploaded 3 September 2026: it reached the vault, 32 rows were read off the
// PDF cleanly, and then it reported that it could not be parsed. Both reasons
// are here.
import { parseIndianDate, num, rowsToLines } from "../lib/bankStatementRows.ts";
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

console.log(fails ? `${fails} failed` : "ok — a credit-card statement files");
process.exit(fails ? 1 : 0);
