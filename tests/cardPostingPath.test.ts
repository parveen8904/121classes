// A card charge to a foreign supplier must be postable, and the refusal must
// say which control to use.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const bank = readFileSync("lib/bankStatements.ts", "utf8");

/* ── the guard stays: it is protecting real money ────────────────────────── */

check("a foreign-currency party is still refused on a rupee account",
  /if \(partyCurrency && partyCurrency !== "INR"\) \{/.test(bank),
  "Zoho reads a PAYMENT in the party's currency — ₹28,500 would clear $28,500 of payable");
check("the refusal shows what it would have destroyed",
  /of their payable wiped out by a charge of/.test(bank),
  "a number makes the danger real; 'currency mismatch' does not");

/* ── but it now names the control and the choice ─────────────────────────── */

check("it names the exact control on the screen",
  /set "Treat it as" to \*\*Expense\*\*/.test(bank),
  "the old advice was 'book it as a Journal instead', which is true and unusable");
check("it says a card charge is a purchase, not a settlement",
  /a card charge is a purchase, not the settling of a bill/.test(bank));
check("Journal is still offered for the case where it IS a settlement",
  /if that is genuinely what this is, use Journal/.test(bank));
check("the card advice only appears for a card",
  /bankAccountKind \?\? ""\) === "credit_card"/.test(bank));

/* ── one lookup, used by both the guard and the posting ──────────────────── */

check("the account is fetched once, above both uses",
  bank.indexOf("const bankAccountKind = bankAcc?.type") < bank.indexOf('const bankCur = bankAcc?.currency'),
  "the guard needed the type before the posting needed the currency");
check("a rupee account still sends no currency block",
  /if \(bankCur !== "INR"\) \{/.test(bank),
  "every existing INR posting must be byte-for-byte what it was");

console.log(fails ? `${fails} failed` : "ok — a card charge can be posted");
process.exit(fails ? 1 : 0);
