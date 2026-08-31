// Zoho's Reference# holds fifty characters. Ours held ninety.
//
// 26-29 August 2026, five expenses failed with "Please ensure that the
// Reference# has less than 50 characters". Every one of them is below, taken
// from the failure list as it appeared on /admin/zoho. The narration was being
// used as the reference whenever the statement's ref column was empty, and a
// bank narration is prose, not a reference.
//
//   node --experimental-strip-types tests/zohoReference.test.ts

import { zohoReference } from "../lib/zohoReference.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// ── the five that failed ────────────────────────────────────────────────────
const FAILED: [string, string][] = [
  ["UPI/P2M/180603244605/BANSAL BUSINESS CORP /Statio/AXIS BANK", "180603244605"],
  ["INB/NEFT/AXODH23957939129/FIRST FLY EXPRESS/IDFC FIRST BANK LTD//////", "AXODH23957939129"],
  ["UPI/P2M/135522325417/shyam Electrostat /NO REM/YES BANK LIMITED YBS", "135522325417"],
  ["UPI/P2M/105452157792/Blinkit /Pay vi/HDFC BANK LTD", "105452157792"],
  ["INB/RTGS/UTIBR62026082904412686/OM ART PRESS/PUNJAB NATIONAL BANK//////", "UTIBR62026082904412686"],
];
for (const [narration, wire] of FAILED) {
  const r = zohoReference("", narration);
  check(`the wire number is lifted out: ${wire}`, r === wire, `got ${JSON.stringify(r)}`);
  check(`and it fits Zoho's limit: ${wire}`, r.length <= 50, `${r.length} characters`);
}

// ── nothing may ever exceed fifty, whatever arrives ─────────────────────────
const LONG = "X".repeat(300);
check("a ref column longer than the limit is cut to it", zohoReference(LONG, "").length === 50);
check("a narration with no wire number yields nothing rather than prose",
  zohoReference("", "CASH DEPOSIT AT BRANCH COUNTER BY SELF, NEW DELHI, VIKAS MARG") === "",
  JSON.stringify(zohoReference("", "CASH DEPOSIT AT BRANCH COUNTER BY SELF, NEW DELHI, VIKAS MARG")));
check("an unparseable narration never leaks in at full length",
  zohoReference("", LONG).length <= 50);

// ── the bank's own reference column always wins ─────────────────────────────
check("the statement's ref column is used when it has one",
  zohoReference("UTIBR52025120100123456", "UPI/P2M/999999999999/SOMEONE") === "UTIBR52025120100123456");
check("whitespace-only ref falls through to the narration",
  zohoReference("   ", "UPI/P2M/180603244605/BANSAL") === "180603244605");

// ── the particulars belong in the description, and still do ────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
const src = readFileSync(join(import.meta.dirname, "..", "lib/bankStatements.ts"), "utf8");
check("the narration still reaches Zoho as the description",
  /extra: `bank statement: \$\{String\(l\.narration/.test(src),
  "the transaction particulars must stay on the document even though they are out of the reference");
check("no caller still slices a reference to 90",
  !/reference[_ ]?(number|:)?[^\n]*slice\(0, 90\)/.test(src),
  "90 is the journal limit, not the expense one");

console.log(fails === 0 ? "ok — Zoho reference" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
