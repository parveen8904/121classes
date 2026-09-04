// A dollar statement must not be printed with a rupee sign.
import { readFileSync } from "node:fs";
import { money, currencySymbol, CURRENCIES } from "../lib/money.ts";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};

check("the rupee still writes like a rupee",
  money(163.73, "INR", 2) === "₹163.73" && money(1234567, "INR") === "₹12,34,567");
check("a dollar writes like a dollar",
  money(163.73, "USD", 2) === "$163.73",
  "his Citi Costco April statement was reading ₹163.73");
check("Indian grouping does NOT follow the dollar",
  money(1234567, "USD") === "$1,234,567",
  "1,23,456 is right for ₹ and wrong for $");
check("an unknown code still says which money it is",
  currencySymbol("CHF") === "CHF ", "better a code than a wrong symbol");
check("no currency at all means rupees", money(5, null, 2) === "₹5.00");
check("the picker offers the ones his accounts use",
  CURRENCIES.includes("INR") && CURRENCIES.includes("USD"));

/* ── it has to be recorded, shown and correctable ────────────────────────── */

const stmts = readFileSync("app/admin/zoho/statements/page.tsx", "utf8");
const bank = readFileSync("lib/bankStatements.ts", "utf8");
const actions = readFileSync("app/admin/zoho/actions.ts", "utf8");

check("the currency is taken from the Zoho account at upload",
  /\.find\(\(a\) => a\.name === accountName\)\?\.currency \|\| "INR"/.test(bank),
  "Zoho holds Credit Card Citi Costco 8145 as USD — it need not be guessed");
check("…and written onto the statement", /\n    currency,\n/.test(bank));
check("the row offers a currency selector",
  /action=\{setStatementCurrencyAction\}/.test(stmts) && /CURRENCIES\.map/.test(stmts));
check("the editor changes the meaning, not the figures",
  /update\(\{ currency: code \}\)/.test(actions) && !/convert/i.test(actions.slice(actions.indexOf("setStatementCurrencyAction"), actions.indexOf("setStatementCurrencyAction") + 1200)));
check("only a real ISO code is accepted",
  /\/\^\[A-Z\]\{3\}\$\/\.test\(code\)/.test(actions));
check("the page no longer hard-codes a rupee on the queue figures",
  !/formatINR\(magnitude\(l\)\)/.test(stmts) && /money\(magnitude\(l\), cur\(l\.account_name\), 2\)/.test(stmts));
check("the remove button is still there",
  /🗑 Remove/.test(stmts), "he asked for remove everywhere — it must not be lost to this change");

console.log(fails ? `${fails} failed` : "ok — a statement is shown in its own money");
process.exit(fails ? 1 : 0);
