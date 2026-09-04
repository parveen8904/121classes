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

console.log(fails ? `${fails} failed` : "ok — a period is shown only where it was bought");
process.exit(fails ? 1 : 0);
