// THE INVOICE WAS READ, AND THE READING WAS THROWN AWAY.
//
// 3 September 2026: "why warehouse and bansal are foreigners".
//
// The currency half of that was already fixed — an invoice nobody could read
// defaulted to USD, and isForeign is `currency !== "INR"`, so a warehouse in
// Pitam Pura was sent to the foreign vendor desk. Rows filed before 1
// September still carry USD; everything since carries "" for unknown.
//
// Underneath it, two faults that were still live.
//
// FIRST, THE SCANNER RE-READ THE PAPER AND GOT NOTHING. It asked the vault for
// five columns and then went back to the PDF itself. These invoices are
// photographs — no text layer — so fetchText returned null and every bill came
// through blank: no number, no invoice date, no figures. The vault had
// meanwhile already taken the picture apart at filing and stored doc_no,
// doc_date and the table in rows_json. The vault screen showed
// "BSTI/26-27/16282 · 26 August 2026" while the bill it raised showed nothing.
//
// Consequences beyond the blanks: bill_date fell back to the FILING date, which
// decides the GST period and the Rule 115 rate; and the duplicate guard keys on
// the invoice number, so three copies of BSTI/26-27/16282 never matched.
//
// SECOND, A GSTIN OFF A PICTURE WAS BELIEVED WITHOUT BEING CHECKED. That one
// invoice was read three times and gave three different numbers, two of them
// impossible. Details in lib/docRead.ts.
//
//   node --experimental-strip-types tests/vaultReadingReachesBill.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkGstin } from "../lib/gstin.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
const bills = read("lib/providerBills.ts");
const docRead = read("lib/docRead.ts");

const scan = bills.slice(bills.indexOf("export async function scanVaultForBills"));
const scanBody = scan.slice(0, scan.indexOf("export async function saveBillRule"));

/* ── the three GSTINs read off ONE invoice ───────────────────────────────── */

const [good, sixteen, badSum] = ["07AMGPS2446C1Z6", "07AAMGPS2446C1Z6", "07AAGPS2446C1Z6"];

check("the readable one is a real Delhi GSTIN",
  checkGstin(good).ok && checkGstin(good).pan === "AMGPS2446C" && checkGstin(good).state === "Delhi");

check("the sixteen-character read is caught",
  !checkGstin(sixteen).ok, "it cannot be a GSTIN at any length but fifteen");

check("the read whose check digit does not match is caught",
  !checkGstin(badSum).ok,
  "this is the one that was actually stored on the bill raised at 11:58 on 3 September");

/* ── so a read GSTIN is checked before it is stored ──────────────────────── */

const whose = docRead.slice(docRead.indexOf("const whose = async"));
const whoseBody = whose.slice(0, whose.indexOf("// ── a spreadsheet"));

check("the party read checks the GSTIN's checksum",
  /checkGstin\(raw\)\.ok/.test(whoseBody),
  "checkGstin sat in the tree for months wired only into the checkout");

check("…and stores nothing rather than a wrong number",
  /\? raw : ""/.test(whoseBody),
  "an empty box gets typed into; a wrong GSTIN forfeits the input credit in GSTR-2B silently");

check("the name is still passed through untouched",
  /const name = String\(p\.party \?\? ""\)\.trim\(\);/.test(whoseBody),
  "only the GSTIN is checkable offline — a name is not ours to second-guess");

/* ── the scanner uses what the vault already read ────────────────────────── */

check("it asks for the vault's own reading, not just the file",
  /doc_no, doc_date, party_gstin, rows_json, doc_text/.test(bills),
  "five columns and a re-read is what produced a blank bill from a photographed invoice");

check("the invoice's own number is taken from the paper",
  /if \(str\(d\.doc_no\)\) facts\.invoice_no = str\(d\.doc_no\);/.test(scanBody));

check("the invoice's own date is too",
  /if \(str\(d\.doc_date\)\) facts\.date = str\(d\.doc_date\);/.test(scanBody),
  "otherwise bill_date is the FILING date — wrong GST period and wrong Rule 115 rate");

check("the vault's table is read when the PDF has no text layer",
  /if \(!text\)[\s\S]{0,400}rowsToCsv\(rows\)/.test(scanBody),
  "a photographed invoice has no text; its table is in rows_json");

check("…and doc_text is the last resort before giving up",
  /else if \(str\(d\.doc_text\)\) text = str\(d\.doc_text\)/.test(scanBody));

check("the paper's number and date still win after the reader has spoken",
  scanBody.indexOf("parseInvoiceText") < scanBody.lastIndexOf("facts.date = str(d.doc_date)"),
  "a second-guess must not overwrite what was transcribed off the invoice");

/* ── and none of it derives a figure ─────────────────────────────────────── */

check("an invoice whose figures could not be read still asks for them",
  /an unreadable PDF still queues — the figures can be typed in/.test(scanBody),
  "the standing rule: read off the invoice, never derived; no figures, no posting");

check("the currency is still unknown rather than guessed either way",
  /const currency = readCurrency \|\| "";/.test(scanBody),
  "USD sent a Delhi warehouse to the foreign desk; INR booked twelve Bunny invoices as rupees");

console.log(fails === 0 ? "ok — the vault's reading reaches the bill" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
