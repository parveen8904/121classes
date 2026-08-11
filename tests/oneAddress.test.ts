import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// THREE ADDRESSES, THREE JOBS, AND ONLY ONE OF THEM GOES ON THE WEBSITE.
//
//   VISITOR OFFICE   W6/30, DLF Phase 3, Sector 24, Gurugram, Haryana 122010
//                    Where students can come. This is the one on the site and
//                    it must match the Google Business Profile character for
//                    character — consistent name/address/phone is how Google
//                    decides two mentions are the same business, and it was
//                    written three different ways across five files.
//
//   REGISTERED       B-173, Nirman Vihar, Delhi 110092
//                    The registered place of business. Belongs on tax invoices,
//                    where the law requires it, and nowhere else. Held in
//                    site_settings.gst_address, never hard-coded.
//
//   VACATED          C-56, Preet Vihar, Delhi 110092
//                    Left. Must never appear anywhere again.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
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

// ── The vacated one is gone, and stays gone ──────────────────────────────
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/preet\s*vihar/i.test(code)) {
    fails++;
    console.log(`FAIL  ${file.replace(root, ".")} — Preet Vihar was vacated and must not be published`);
  }
}

// ── The registered address is not hard-coded into a page ─────────────────
// It reaches an invoice through site_settings.gst_address. A copy in a page is
// a copy that will not change when the registration does.
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/nirman\s*vihar/i.test(code)) {
    fails++;
    console.log(`FAIL  ${file.replace(root, ".")} — the REGISTERED address belongs in gst_address, not in code`);
  }
}

// ── The visitor address is written exactly one way ───────────────────────
const CANON = "W6/30, DLF Phase 3, Sector 24, Gurugram, Haryana 122010";
const shown: { file: string; text: string }[] = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Any rendered mention of the Gurugram office, however spelled.
  for (const m of code.matchAll(/W\s?6[^\n"'`]{0,80}?122010/gi)) {
    shown.push({ file: file.replace(root, "."), text: m[0].trim() });
  }
}
check(shown.length > 0, "the visitor address appears on the site at all");
for (const s of shown) {
  check(s.text === CANON, `${s.file} writes it as "${s.text}" — every mention must be exactly "${CANON}"`);
}

// The structured data carries the parts separately, so check those too.
const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
for (const [field, value] of [
  ["streetAddress", "W6/30, DLF Phase 3, Sector 24"],
  ["addressLocality", "Gurugram"],
  ["addressRegion", "Haryana"],
  ["postalCode", "122010"],
] as const) {
  check(new RegExp(`${field}:\\s*"${value.replace(/[/.]/g, "\\$&")}"`).test(layout),
    `schema ${field} is "${value}"`);
}

console.log(fails === 0 ? `PASS  one visitor address, written identically in ${shown.length} places; registered and vacated addresses absent` : "");
process.exit(fails === 0 ? 0 : 1);
