import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatDate, formatDateTime, formatTime, formatMonth, formatDateWithDay } from "../lib/dates";

// ONE DATE FORMAT ACROSS THE WHOLE SITE: 25 August 2026.
//
// There were a dozen. "9 Aug 2026" here, "Aug 9, 2026" there, "09/08/2026"
// somewhere else. A student reading "05/08" cannot tell the fifth of August
// from the eighth of May, and neither can an accountant reading an invoice.
//
// Two halves to this: the format itself is right, and nobody quietly writes
// their own next to it.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── The format ────────────────────────────────────────────────────────────
// 25 August 2026, 15:30 IST — expressed as UTC so the test does not depend on
// the machine it runs on.
const t = "2026-08-25T10:00:00Z";                 // 15:30 IST
check(formatDate(t) === "25 August 2026", `date reads "25 August 2026" (got "${formatDate(t)}")`);
check(formatTime(t) === "3:30 pm", `time reads "3:30 pm" (got "${formatTime(t)}")`);
check(formatDateTime(t) === "25 August 2026, 3:30 pm", `date and time together (got "${formatDateTime(t)}")`);
check(formatMonth(t) === "August 2026", `month heading (got "${formatMonth(t)}")`);
check(formatDateWithDay(t) === "Tuesday, 25 August 2026", `with weekday (got "${formatDateWithDay(t)}")`);

// Never "Aug", never a number for the month, never a slash.
for (const [name, out] of [["date", formatDate(t)], ["datetime", formatDateTime(t)]] as const) {
  check(!/\b\d{1,2}\/\d{1,2}/.test(out), `${name} must not use slashes`);
  check(/August/.test(out), `${name} must write the month out in full`);
  check(!/\bAug\b/.test(out), `${name} must not abbreviate the month`);
}

// ── The timezone trap ─────────────────────────────────────────────────────
// 25 August 20:00 UTC is already the 26th in India. A student in Delhi must be
// told the 26th, whatever timezone the server happens to be in.
check(formatDate("2026-08-25T20:00:00Z") === "26 August 2026",
  "late-evening UTC must render as the NEXT day in India");
// And just before midnight IST it is still the same day.
check(formatDate("2026-08-25T18:00:00Z") === "25 August 2026",
  "…but 18:00 UTC is 11:30 pm IST, still the 25th");

// ── Nothing, rather than "Invalid Date" ───────────────────────────────────
for (const bad of [null, undefined, "", "not a date"]) {
  check(formatDate(bad) === "—", `${JSON.stringify(bad)} shows a dash, never "Invalid Date"`);
  check(formatDateTime(bad) === "—", `${JSON.stringify(bad)} datetime shows a dash`);
}
check(formatDate(null, "not set") === "not set", "the fallback can be chosen by the caller");

// ── And nobody writes their own alongside it ──────────────────────────────
const root = join(import.meta.dirname, "..");
const files: string[] = [];
for (const dir of ["app", "lib"]) {
  (function walk(d: string) {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  })(join(root, dir));
}

const allowed = join(root, "lib", "dates.ts");
for (const file of files) {
  if (file === allowed) continue;
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (/toLocaleDateString\(/.test(line)) {
      fails++;
      console.log(`FAIL  ${file.replace(root, ".")}:${i + 1} — toLocaleDateString. Use formatDate from @/lib/dates.`);
    }
    // toLocaleString on a NUMBER is fine (rupees); on a date it is not.
    if (/toLocaleString\(/.test(line) && /(dateStyle|timeStyle|weekday|month:)/.test(line)) {
      fails++;
      console.log(`FAIL  ${file.replace(root, ".")}:${i + 1} — a date formatted by hand. Use @/lib/dates.`);
    }
  });
}

console.log(fails === 0 ? `PASS  one date format: 25 August 2026, in IST, across ${files.length} files` : "");
process.exit(fails === 0 ? 0 : 1);
