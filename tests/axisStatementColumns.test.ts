// The columns of his own Axis "Smart Statement".
//
// 1 September 2026, statement 2026082931_AXIS_87117.xlsx for the Aldine CA
// current account. Its header row, verbatim, is in HEADER below. Three things
// about it defeated the parser:
//
//   · the particulars column is "Transaction Particulars", not "Narration"
//   · the reference is "Internal Reference Number", which matched nothing
//   · "Cheque Number" DID match, sits further left, and is empty on every
//     electronic line — so first-past-the-post picked the blank column
//
// Ravi asked for the internal reference number to be the one used. This checks
// that it is, against the real header.
//
//   node --experimental-strip-types tests/axisStatementColumns.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
// THE REAL RULES, IMPORTED.
//
// This used to dig the regexes out of the source with another regex, because
// they lived in a file that pulls in Supabase and the Zoho client and could not
// be loaded. They now live on their own in lib/bankStatementRows.ts, so the
// test reads the actual objects — and a rule that is renamed or deleted breaks
// the test instead of quietly matching nothing.
import { HEAD, REF_TIERS } from "../lib/bankStatementRows.ts";

const src = readFileSync(join(import.meta.dirname, "..", "lib/bankStatementRows.ts"), "utf8");

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const headRegex = (key: string): RegExp => {
  const re = (HEAD as Record<string, RegExp>)[key];
  if (!re) throw new Error(`HEAD.${key} no longer exists`);
  return re;
};
const refTiers = (): RegExp[] => REF_TIERS;

const HEADER = [
  "S. No.", "Transaction Date", "Value Date", "Cheque Number",
  "Transaction Particulars", "Amount", "Transaction Type", "Balance",
  "Remarks", "Internal Reference Number", "UTR Number", "Payment Mode",
  "Transaction ID",
];

const date = headRegex("date");
const narration = headRegex("narration");
const ref = headRegex("ref");

check("the date column is found", HEADER.some((h) => date.test(h)));
check("the particulars column is found as the narration",
  HEADER.findIndex((h) => narration.test(h)) === HEADER.indexOf("Transaction Particulars"),
  `matched ${HEADER.find((h) => narration.test(h))}`);
check("‘Internal Reference Number’ is recognised as a reference at all",
  ref.test("Internal Reference Number"));
check("‘UTR Number’ is recognised too", ref.test("UTR Number"));

// ── the priority, which is the whole point ─────────────────────────────────
const tiers = refTiers();
const pick = (header: string[]) => {
  for (const t of tiers) {
    const i = header.findIndex((h) => t.test(h));
    if (i >= 0) return header[i];
  }
  return null;
};
check("on his statement the INTERNAL reference wins, not the cheque column",
  pick(HEADER) === "Internal Reference Number", String(pick(HEADER)));
check("‘Cheque Number’ would have won without the priority — it is further left",
  HEADER.indexOf("Cheque Number") < HEADER.indexOf("Internal Reference Number"));

// ── other banks' shapes still resolve sensibly ─────────────────────────────
check("a statement with only a UTR column uses it",
  pick(["Date", "Narration", "UTR", "Debit"]) === "UTR");
check("a statement with only a cheque column falls back to it",
  pick(["Date", "Particulars", "Chq/Ref No", "Withdrawal Amt."]) === "Chq/Ref No");
check("a plain ‘Reference No’ beats a cheque column",
  pick(["Date", "Narration", "Cheque No", "Reference No"]) === "Reference No");
check("no reference column at all is not an error",
  pick(["Date", "Narration", "Debit", "Credit"]) === null);

// ── and the desk's own template column names ───────────────────────────────
check("‘Statement Description’ is accepted as the particulars",
  narration.test("Statement Description"));
check("‘Reference Number’ is accepted as the reference",
  ref.test("Reference Number"));

/* ═══════════════════════════════════════════════════════════════════════════
   A CREDIT CARD STATEMENT GOES THROUGH THE SAME DOOR
   ═══════════════════════════════════════════════════════════════════════════

   His question, 2 September 2026: "can I use the same framework that you are
   already having for the banks to post my credit card statements? Also, will
   you be able to do and reconcile accordingly?"

   Yes. The account picker has always offered credit-card accounts beside the
   banks, and the entry a card needs is the one already made — money spent is
   Dr the head, Cr the card, which is what increases the liability. What was
   missing was the way cards WRITE a statement, and that is what these hold.

   Read against the real regexes and the real source, the same way as above.
*/
const CARD_HEADERS = ["Transaction Date", "Description of Transaction", "Amount (in Rs.)"];
const CARD_HEADERS_2 = ["Date", "Merchant Name", "Amount", "Dr/Cr"];
const amount = headRegex("amount");
const drcr = headRegex("drcr");

check("a card's date column is found", CARD_HEADERS.some((h) => date.test(h)));
check("‘Description of Transaction’ is the narration",
  CARD_HEADERS.findIndex((h) => narration.test(h)) === CARD_HEADERS.indexOf("Description of Transaction"),
  `matched ${CARD_HEADERS.find((h) => narration.test(h))}`);
check("‘Merchant Name’ is the narration on the cards that call it that",
  narration.test("Merchant Name") && narration.test("Merchant"));
check("‘Amount (in Rs.)’ is an amount column",
  amount.test("Amount (in Rs.)") && amount.test("Amount"),
  "the unit written into the header used to lose the whole column");
check("a card's own Dr/Cr column is still recognised",
  CARD_HEADERS_2.some((h) => drcr.test(h)));
check("the narration regex does not swallow the amount column",
  !narration.test("Amount (in Rs.)"));

// "12,340.00 Cr" — the direction written inside the amount cell. It used to
// parse as NaN, which became 0, which dropped the row entirely.
check("a trailing Cr/Dr marker is stripped before the figure is read",
  /\.replace\(\/\\s\*\(cr\|dr\)\\\.\?\\s\*\$\/i, ""\)/.test(src),
  "otherwise the amount is NaN, becomes zero, and the line is silently skipped");
check("the direction is taken from the marker column OR from the amount cell",
  /const t = \(cell\("drcr"\) \|\| raw\)\.toLowerCase\(\)/.test(src));
check("on a card, Cr is a payment against it — the credit column, like money in",
  /\/\\bcr\\b\|\\bcredit\\b\/\.test\(t\)\) credit = Math\.abs\(amt\)/.test(src));
check("credit-card accounts are offered for upload beside the banks",
  /a\.type === "bank" \|\| a\.type === "credit_card"/.test(
    readFileSync(join(import.meta.dirname, "..", "app/admin/zoho/statements/page.tsx"), "utf8")));

console.log(fails === 0 ? "ok — Axis statement columns" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
