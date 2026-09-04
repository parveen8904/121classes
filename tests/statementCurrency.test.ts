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

/* ── and the ENTRY has to carry it, or Zoho refuses ─────────────────────── */

// "zoho does not post entry. it says correct currency." — 4 September 2026.
// Neither document sent a currency, so Zoho fell back to the org's rupee and
// refused every line on a USD account.
check("the posting asks Zoho what the bank account is held in",
  /const bankAcc = \(await listZohoAccounts\(\)[\s\S]{0,120}a\.name === String\(l\.account_name\)\)/.test(bank),
  "so it cannot drift from the books");
check("an expense carries the currency", /\.\.\.\(fx \?\? \{\}\),\n {8}\},\n {6}\}\);\n {6}if \(!r\.expense/.test(bank));
check("a journal carries it too", /line_items: lines,\n {10}\.\.\.\(fx \?\? \{\}\),/.test(bank));
check("a rupee entry is unchanged",
  /if \(bankCur !== "INR"\)/.test(bank),
  "fx stays undefined for INR, so every existing posting sends exactly what it did");
check("the rate is Rule 115, the same one the brokerage journals use",
  /rule115Rate\(String\(l\.line_date\), bankCur\)/.test(bank));
check("no rate means no posting",
  /Nothing was posted rather than booking it at a guessed rate/.test(bank),
  "a wrong rate is a wrong figure in the books that nothing downstream can catch");
check("the currency id comes off the account, with a lookup as fallback",
  /bankAcc\?\.currencyId \|\| \(await currencyIdForCode\(bankCur\)\)/.test(bank));

/* ── one screen, one currency ────────────────────────────────────────────── */

// "your entry was showing dollars at one place and INR at others" — the same
// money named two ways on one screen, which is worse than being wrong once.
const entryLines = readFileSync("app/admin/zoho/EntryLines.tsx", "utf8");
const panel = readFileSync("app/admin/zoho/BankAnswerPanel.tsx", "utf8");

check("the entry's column heads are not hard-coded to the rupee",
  !/>DEBIT ₹</.test(entryLines) && /DEBIT \{sym\.trim\(\)\}/.test(entryLines));
check("its out-of-balance line uses the same symbol",
  !/does not balance — ₹/.test(entryLines) && /does not balance — \{sym\}/.test(entryLines));
check("its grouping follows the currency too",
  /cur === "INR" \? "en-IN" : "en-US"/.test(entryLines),
  "1,23,456.78 is right for ₹ and wrong for $");
check("it still defaults to the rupee",
  /currency = "INR",/.test(entryLines), "every existing preview must be untouched");

check("the answer panel's figure is not hard-coded either",
  !/₹\{amount\.toLocaleString/.test(panel) && /currencySymbol\(cur\)\}\{amount\.toLocaleString/.test(panel));
check("the panel hands the same currency to the entry beneath it",
  /<EntryLines entry=\{entry\}[^/]*currency=\{cur\}/.test(panel),
  "the figure and the entry under it must agree");

check("every panel and preview on the statements page is given one",
  (stmts.match(/currency=\{cur\(/g) ?? []).length >= 5,
  "one missed call is the inconsistency all over again");

console.log(fails ? `${fails} failed` : "ok — one screen, one currency");
process.exit(fails ? 1 : 0);
