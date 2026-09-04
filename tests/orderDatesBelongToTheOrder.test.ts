// A validity period is shown only against the order that bought it.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const src = readFileSync("app/admin/orders/page.tsx", "utf8");

check("an order that granted no access is recognised",
  /const orderGrantedAccess = \["paid", "provisioned", "dispatched", "delivered"\]\.includes\(String\(p\.status\)\)/.test(src));
check("dates are not looked up at all for an unpaid order",
  /const dates = orderGrantedAccess && pr && p\.subject_id/.test(src),
  "the lookup is keyed on student+subject, so an unpaid order was showing a PAID order's period");
check("and the row says why it is blank",
  /not paid — no access granted by this order/.test(src),
  "a bare dash reads as missing data; this reads as a fact");
check("a paid order still shows its period",
  /orderGrantedAccess\s*\n?\s*\? <>🗓️ \{dates\?\.starts_at/.test(src));
check("a paid order with no subscription still falls back to a dash",
  /dates\?\.starts_at \? fmt\(dates\.starts_at\) : "—"/.test(src),
  "paid but not yet provisioned is a real state and must not be hidden");

/* ── and the TERM is read off the price list, not borrowed either ────────── */

import { termFromAmount, parseSlabs } from "../lib/pricing.ts";

// Financial Reporting's real ladders.
const gold = parseSlabs([{ rate: 1000, upto: 1 }, { rate: 850, upto: 3 }, { rate: 825, upto: 6 }, { rate: 787, upto: 12 }, { rate: 300, upto: 24 }]);
const silver = parseSlabs([{ rate: 500, upto: 1 }, { rate: 350, upto: 3 }, { rate: 325, upto: 6 }, { rate: 287, upto: 12 }, { rate: 200, upto: 24 }]);

check("₹2,700 is three months of Gold, not one",
  JSON.stringify(termFromAmount(2700, gold, silver)) === '{"tier":"gold","months":3}',
  'the register printed "Gold · 1 month" beside it, borrowed from her paid ₹1,000 order');
check("₹1,000 is one month of Gold", JSON.stringify(termFromAmount(1000, gold, silver)) === '{"tier":"gold","months":1}');
check("₹11,697 is eighteen months of Gold — Rohit's order",
  termFromAmount(11697, gold, silver)?.months === 18);
check("an amount matching BOTH ladders is refused, not guessed",
  termFromAmount(1850, gold, silver) === null,
  "₹1,850 is Gold 2 months and Silver 5 months; naming one would be inventing a fact");
check("an amount matching nothing is refused", termFromAmount(999, gold, silver) === null);
check("no ladder means no claim", termFromAmount(2700, null, null) === null);

check("the register only derives a term when no subscription granted one",
  /const priced = !dates && p\.subject_id/.test(src),
  "a real subscription is always the better authority");

console.log(fails ? `${fails} failed` : "ok — a period and a term are shown only where they were bought");
process.exit(fails ? 1 : 0);
