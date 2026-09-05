// The tax worksheet must read the expense side of the books.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const eng = readFileSync("lib/taxEngine.ts", "utf8");
const page = readFileSync("app/admin/zoho/tax/page.tsx", "utf8");
const bank = readFileSync("lib/bankStatements.ts", "utf8");

/* ── trap 1: the filter that hides every expense head ────────────────────── */

check("the chart is asked for with AccountType.All",
  /filter_by: "AccountType\.All"/.test(eng) && !/filter_by: "AccountType\.Active"/.test(eng),
  'under "Active" Zoho returns not one expense, other_expense or cost_of_goods_sold account');
check("the same lesson is already written down beside the other caller",
  /AccountType\.All returns them/.test(bank),
  "it was learned once and this file never got it");

/* ── trap 2: the flag that lies ──────────────────────────────────────────── */

check("pages are read until one comes back EMPTY",
  /const batch = r\.chartofaccounts \?\? \[\];\s*\n\s*if \(!batch\.length\) break;/.test(eng));
check("has_more_page is not trusted", !/r\.page_context\?\.has_more_page/.test(eng),
  "page 2 says false and page 3 then hands over every expense head in the chart");
check("and there is room to reach it", /page <= 12/.test(eng),
  "the old loop stopped at three pages");

/* ── and it refuses to publish a turnover as a profit ────────────────────── */

check("a chart with no expense head at all is refused",
  /expenseHeads === 0/.test(eng) && /throw new Error\(/.test(eng),
  "zero expenses is this bug returning, not a business without costs");
check("the refusal explains itself rather than vanishing",
  /taxError = e instanceof Error \? e\.message/.test(page) && /\{taxError \? </.test(page),
  "a figure nobody could question is worse than a sentence saying what went wrong");

console.log(fails ? `${fails} failed` : "ok — the tax worksheet reads both sides of the books");
process.exit(fails ? 1 : 0);
