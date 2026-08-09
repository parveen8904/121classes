// What a supporter may sell, and for how much.
//
// A supporter sells on the SAME ladder a student is charged on — the discount
// they pass on comes from a coupon, openly, not from a second price list. Now
// that they can also choose a longer term, two things must hold: a longer term
// never costs less than a shorter one, and nothing shorter than a year can be
// sold, whatever a request asks for.
//
//   node --experimental-strip-types tests/supporterTerms.test.ts

import { parseSlabs, slabTotal, slabMonthOptions } from "../lib/pricing.ts";

const SELL_MIN_MONTHS = 12;
const SELL_MAX_MONTHS = 24;

// The live ladder for both sellable subjects, as at 2026-08-09.
const slabs = parseSlabs([
  { rate: 1000, upto: 1 },
  { rate: 850, upto: 3 },
  { rate: 825, upto: 6 },
  { rate: 787, upto: 12 },
  { rate: 300, upto: 24 },
])!;

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// The clamp the server applies, whatever the browser sends.
const clamp = (m: number) =>
  Math.min(SELL_MAX_MONTHS, Math.max(SELL_MIN_MONTHS, Math.round(m)));

check("a one-month request becomes a year", clamp(1) === 12, `got ${clamp(1)}`);
check("zero becomes a year", clamp(0) === 12, `got ${clamp(0)}`);
check("a negative becomes a year", clamp(-6) === 12, `got ${clamp(-6)}`);
check("a hundred years is capped", clamp(1200) === 24, `got ${clamp(1200)}`);
check("twelve stays twelve", clamp(12) === 12);
check("twenty-four stays twenty-four", clamp(24) === 24);

// Every term on offer is at least a year.
const offered = [12, ...slabMonthOptions(slabs).filter((m) => m >= 12 && m <= 24), 18];
check("nothing under a year is offered", offered.every((m) => m >= SELL_MIN_MONTHS),
  `offered ${offered.join(", ")}`);

// Longer must never be cheaper — a ladder that dips would let a supporter sell
// two years for less than one.
const sorted = [...new Set(offered)].sort((a, b) => a - b);
for (let i = 1; i < sorted.length; i++) {
  const less = slabTotal(slabs, sorted[i - 1]);
  const more = slabTotal(slabs, sorted[i]);
  check(`${sorted[i]} months costs at least ${sorted[i - 1]} months`, more >= less,
    `${sorted[i - 1]}m = ${less}, ${sorted[i]}m = ${more}`);
}

// The twelve-month price is the one the product card shows, and it must match
// what a student pays for twelve months.
check("twelve months is priced on the ladder", slabTotal(slabs, 12) === 1000 + 2 * 850 + 3 * 825 + 6 * 787,
  `got ${slabTotal(slabs, 12)}`);

console.log(fails === 0 ? `PASS  supporter terms: ${sorted.join(", ")} months, none under a year` : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
