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

/* ── a matched line has to READ as done ─────────────────────────────────── */

const stmts = readFileSync("app/admin/zoho/statements/page.tsx", "utf8");

check("a finished statement says so plainly",
  /✓ done — nothing left to post/.test(stmts),
  "'all lines filed' did not tell him the four Citi charges were already in Zoho");
check("and says what the done was made of",
  /already in Zoho/.test(stmts) && /posted from here/.test(stmts),
  "posted BY US and already in Zoho are both finished and are not the same fact");
check("the two totals are counted separately",
  /\.eq\("status", "posted"\)/.test(stmts) && /\.eq\("status", "matched"\)/.test(stmts),
  "one 'posted/matched' number hid which entries were ever ours to write");
check("the legend explains what matched means",
  /the money is already in Zoho, usually put there by the bank/.test(stmts));

check("the proposals block cannot be read as done",
  /Settlements to approve/.test(stmts) && !/>\s*Settlements found/.test(stmts),
  "'found' beside a status literally called matched read as the same thing finished");
check("…and it says outright that nothing there is booked",
  /not posted yet/.test(stmts) && /Nothing here has been booked/.test(stmts));

console.log(fails ? `${fails} failed` : "ok — a card charge can be posted, and a done line says so");
process.exit(fails ? 1 : 0);
