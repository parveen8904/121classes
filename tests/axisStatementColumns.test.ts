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

const src = readFileSync(join(import.meta.dirname, "..", "lib/bankStatements.ts"), "utf8");

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

/** Pull a named regex literal out of the source so the test reads the real one. */
function headRegex(key: string): RegExp {
  const m = new RegExp(`^\\s*${key}: (/.*/i),`, "m").exec(src);
  if (!m) throw new Error(`could not find HEAD.${key}`);
  const body = m[1].slice(1, m[1].lastIndexOf("/"));
  return new RegExp(body, "i");
}
function refTiers(): RegExp[] {
  const block = /const REF_TIERS: RegExp\[\] = \[([\s\S]*?)\];/.exec(src);
  if (!block) throw new Error("could not find REF_TIERS");
  return [...block[1].matchAll(/\/(.+?)\/i,/g)].map((m) => new RegExp(m[1], "i"));
}

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

console.log(fails === 0 ? "ok — Axis statement columns" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
