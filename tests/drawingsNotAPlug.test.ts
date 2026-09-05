// The capital account must not close on a single unexplained plug.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const eng = readFileSync("lib/itrReturn.ts", "utf8");
const page = readFileSync("app/admin/zoho/itr/page.tsx", "utf8");

check("what the books DO name is separated out",
  /const personalDrawings = pl\s*\n\s*\.filter\(\(r\) => r\.bucket === "PERSONAL"\)/.test(eng),
  "every PERSONAL ledger is a personal cost met from the business — that is drawings, by name");
check("the remainder is not called drawings",
  /const unexplained = drawings - personalDrawings;/.test(eng));
check("both reach the page", /personalDrawings, unexplained,/.test(eng));

check("magnitude is NOT used",
  !/Math\.abs\(signed\(r\)\)/.test(eng) && /a - signed\(r\)/.test(eng),
  '"Foreign Exchange Difference" is ₹78,39,560.88 of INCOME; abs() would count a gain as spending');

/* the signing, proved on the real ledgers */
const isExp = (p: string) => /Expense|Cost of Goods/i.test(p);
const signed = (a: number, p: string) => (isExp(p) ? -a : a);
const contrib = (a: number, p: string) => -signed(a, p);
check("an expense is drawings taken",
  contrib(1067563.95, "Net Profit/Loss > Non Operating Expense") === 1067563.95);
check("an income REDUCES drawings, it is not spending",
  contrib(7839560.88, "Net Profit/Loss > Non Operating Income") === -7839560.88,
  "taking its magnitude would swing that one ledger by ₹1.57 crore");

/* ── and the page shows it, with the right word ──────────────────────────── */

check("the bare 'balancing figure' row is gone",
  !/Less: drawings \(balancing figure\)/.test(page),
  "a plug always balances, which is exactly why it hides");
check("personal spending is its own line",
  /Less: personal expenses met from the business/.test(page));
check("a shortfall and a surplus are worded differently",
  /Less: not explained by the books/.test(page) && /Add: not explained by the books/.test(page),
  "his is NEGATIVE — more capital than the figures account for — and 'Less' would read as money spent");
check("and it is called out, not left as a number in a column",
  /does not come from the books/.test(page) && /notice err/.test(page));
check("a capital account that DOES close says nothing",
  /Math\.abs\(pack\.business\.unexplained\) >= 1 &&/.test(page),
  "an alarm that fires on rounding is an alarm nobody reads");

console.log(fails ? `${fails} failed` : "ok — the capital account no longer closes on a plug");
process.exit(fails ? 1 : 0);
