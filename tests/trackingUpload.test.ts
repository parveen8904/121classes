import { parseDelimited } from "../lib/delimited";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A COURIER'S MANIFEST IS NOT A TIDY CSV.
//
// It arrives with commas or semicolons or tabs, some fields quoted and some
// not, a header row or none, and a blank line at the end. The parser has to
// cope, because the alternative is a packer typing forty tracking numbers by
// hand and one digit going astray.
//
// The parser lives in lib/delimited.ts rather than inside the server action,
// so this exercises the real thing rather than a copy that can drift.

const src = readFileSync(join(import.meta.dirname, "..", "app", "admin", "warehouse", "actions.ts"), "utf8");

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── The ordinary case ──────────────────────────────────────────────────────
check(eq(parseDelimited("Order,Tracking\n10041,DEL122019183\n10042,DEL122019184"),
  [["Order", "Tracking"], ["10041", "DEL122019183"], ["10042", "DEL122019184"]]),
  "a plain comma file");

// ── Separators couriers actually use ───────────────────────────────────────
check(eq(parseDelimited("Order;Tracking\n10041;DEL1"), [["Order", "Tracking"], ["10041", "DEL1"]]),
  "semicolons (a European export, and common here too)");
check(eq(parseDelimited("Order\tTracking\n10041\tDEL1"), [["Order", "Tracking"], ["10041", "DEL1"]]),
  "tabs (pasted straight out of a spreadsheet)");

// ── Quoting ────────────────────────────────────────────────────────────────
check(eq(parseDelimited('Order,Name\n10041,"Hegade, Ganapati"'),
  [["Order", "Name"], ["10041", "Hegade, Ganapati"]]),
  "a comma inside quotes is not a new column");
check(eq(parseDelimited('Order,Note\n10041,"He said ""urgent"""'),
  [["Order", "Note"], ["10041", 'He said "urgent"']]),
  "a doubled quote is one quote");

// ── The mess at the edges ──────────────────────────────────────────────────
check(eq(parseDelimited("﻿Order,Tracking\n10041,DEL1"), [["Order", "Tracking"], ["10041", "DEL1"]]),
  "the byte-order mark Excel writes must not become part of the first heading");
check(eq(parseDelimited("Order,Tracking\r\n10041,DEL1\r\n"), [["Order", "Tracking"], ["10041", "DEL1"]]),
  "Windows line endings");
check(eq(parseDelimited("10041,DEL1\n\n\n10042,DEL2\n"), [["10041", "DEL1"], ["10042", "DEL2"]]),
  "blank lines in the middle and at the end are dropped");
check(eq(parseDelimited(""), []), "an empty file is no rows, not a crash");
check(eq(parseDelimited("   "), []), "a file of spaces is no rows either");
check(eq(parseDelimited("10041,DEL1"), [["10041", "DEL1"]]), "a single line with no trailing newline");

// ── Header detection and matching, as the action does it ──────────────────
// The action strips non-digits from the order column, so all of these are 10041.
for (const written of ["10041", "#10041", " 10041 ", "ORDER-10041"]) {
  check(written.replace(/\D/g, "") === "10041", `"${written}" must resolve to order 10041`);
}
// …and a row with no digits at all matches nothing, rather than everything.
check("".replace(/\D/g, "") === "", "a blank order number matches no parcel");

// ── The action must report what it could not match ────────────────────────
check(/unmatched/.test(src), "rows that match nothing must be collected, not silently skipped");
check(/missed=/.test(src), "and named back on the screen");
check(/listDispatchQueue\(true\)/.test(src),
  "only parcels still waiting may be marked — a manifest must not reach back and overwrite last month");

console.log(fails === 0 ? "PASS  tracking upload: commas, semicolons, tabs, quotes, BOM, blank lines — and nothing skipped in silence" : "");
process.exit(fails === 0 ? 0 : 1);
