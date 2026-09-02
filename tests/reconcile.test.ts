// Reconciling a bank statement against Zoho's own register.
//
// His question, 1 September 2026: "why don't you simply reconcile statements
// with Zoho books with same bank and find missing entries and suggest entries".
//
// What made it worth asking: three transactions were deleted from Zoho after a
// wrong AI mapping, the statement was uploaded again, and all the portal could
// say was "continuity break". It knew the arithmetic did not close; it could
// not name a single line. These tests hold the rules that let it name them.
//
//   node --experimental-strip-types tests/reconcile.test.ts

import { pairLines, matchKey } from "../lib/reconcile.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const S = (date: string, amount: number, dir: "in" | "out", narration = "", lineStatus = "ask") =>
  ({ date, amount, dir, narration, lineStatus });
const Z = (date: string, amount: number, dir: "in" | "out", note = "", type = "expense") =>
  ({ date, amount, dir, note, type });

// ── the plain case ──────────────────────────────────────────────────────────
{
  const r = pairLines(
    [S("2026-08-01", 5000, "out", "AWS"), S("2026-08-02", 12000, "in", "Fees")],
    [Z("2026-08-01", 5000, "out", "AWS"), Z("2026-08-02", 12000, "in", "Fees", "customer_payment")],
  );
  check("everything agrees", r.matched === 2 && !r.statementOnly.length && !r.zohoOnly.length);
  check("both totals are reported", r.statementTotalOut === 5000 && r.zohoTotalIn === 12000);
}

// ── the case that actually happened: entries deleted out of Zoho ────────────
{
  const stmt = [S("2026-08-01", 5000, "out"), S("2026-08-03", 7500, "out"), S("2026-08-04", 900, "out")];
  const r = pairLines(stmt, [Z("2026-08-01", 5000, "out")]);
  check("the two deleted entries are named, not merely counted",
    r.statementOnly.length === 2 &&
    r.statementOnly[0].date === "2026-08-03" && r.statementOnly[1].amount === 900,
    JSON.stringify(r.statementOnly));
  check("nothing is wrongly reported on the Zoho side", r.zohoOnly.length === 0);
  check("the line's own queue status travels with it, so it can be acted on",
    r.statementOnly[0].lineStatus === "ask");
}

// ── the OTHER direction, which nothing looked at before ────────────────────
{
  const r = pairLines([S("2026-08-01", 5000, "out")], [Z("2026-08-01", 5000, "out"), Z("2026-07-20", 41000, "out", "Rent", "expense")]);
  check("a Zoho entry with no bank line behind it is surfaced",
    r.zohoOnly.length === 1 && r.zohoOnly[0].amount === 41000);
  check("it carries what Zoho calls it, so it can be found there",
    r.zohoOnly[0].zohoType === "expense" && r.zohoOnly[0].zohoNote === "Rent");
}

// ── one entry cannot settle two identical payments ─────────────────────────
{
  const r = pairLines(
    [S("2026-08-05", 2500, "out", "Ravi advance"), S("2026-08-05", 2500, "out", "Ravi advance")],
    [Z("2026-08-05", 2500, "out", "Ravi advance")],
  );
  check("two identical payments need two entries in Zoho",
    r.matched === 1 && r.statementOnly.length === 1,
    `matched ${r.matched}, unmatched ${r.statementOnly.length}`);
}
{
  const r = pairLines(
    [S("2026-08-05", 2500, "out")],
    [Z("2026-08-05", 2500, "out"), Z("2026-08-05", 2500, "out")],
  );
  check("and the surplus entry is reported the other way",
    r.matched === 1 && r.zohoOnly.length === 1);
}

// ── direction and date are part of the identity ────────────────────────────
{
  const r = pairLines([S("2026-08-05", 2500, "in")], [Z("2026-08-05", 2500, "out")]);
  check("money in never settles against money out", r.matched === 0 && r.statementOnly.length === 1 && r.zohoOnly.length === 1);
}
{
  const r = pairLines([S("2026-08-05", 2500, "out")], [Z("2026-08-06", 2500, "out")]);
  check("a day apart is not the same transaction", r.matched === 0);
}

// ── the key itself ─────────────────────────────────────────────────────────
check("the key is the one fetchZohoBankTxnsFor already builds",
  matchKey("2026-08-05", 2500, "out") === "2026-08-05|2500.00|out",
  matchKey("2026-08-05", 2500, "out"));
check("paise are not lost to floating point",
  matchKey("2026-08-05", 0.1 + 0.2, "out") === "2026-08-05|0.30|out");

// ── zero-value rows are not findings ───────────────────────────────────────
{
  const r = pairLines([S("2026-08-05", 0, "out", "balance carried")], []);
  check("a zero-amount row is skipped, not reported as missing", r.statementOnly.length === 0);
}

// ── an empty register must not read as "everything is missing" silently ────
{
  const r = pairLines([S("2026-08-01", 5000, "out"), S("2026-08-02", 900, "out")], []);
  check("with no Zoho entries at all, every line is unmatched",
    r.statementOnly.length === 2 && r.matched === 0);
}

// ── the caller must use it, and must not post anything ─────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
const bank = readFileSync(join(import.meta.dirname, "..", "lib/bankStatements.ts"), "utf8");
const fn = bank.slice(bank.indexOf("export async function reconcileAccount"));
check("reconcileAccount pairs through the tested function", /pairLines\(statement, zoho\)/.test(fn));
check("it reuses the existing Zoho reader rather than a second one",
  /fetchZohoBankTxnsFor\(accountName, from, to\)/.test(fn));
check("it never writes: no insert, update, delete or Zoho POST",
  !/\.insert\(|\.update\(|\.delete\(|method: "POST"/.test(fn.slice(0, fn.indexOf("\n}\n"))),
  "reconciliation reads the books, it does not change them");

// ── continuity is gone, 2 September ────────────────────────────────────────
// "why you need continuity break. I may keep on uploading any statement from
//  any start date. You have to reconciliation and find missing entries."
check("nothing computes a continuity verdict any more",
  !/const continuity\s*=/.test(bank) && !/continuity_ok:/.test(bank),
  "an opening-vs-previous-closing test flags a good file and names no line");
check("no statement is measured against the one before it",
  !/\.lt\("period_end", first\.date\)/.test(bank),
  "statements arrive in any order, from any start date");
const page = readFileSync(join(import.meta.dirname, "..", "app/admin/zoho/statements/page.tsx"), "utf8");
check("the desk is never shown a continuity break again",
  !/continuity break/i.test(page));

// ── every upload reconciles, and it costs nothing extra ────────────────────
const ingest = bank.slice(0, bank.indexOf("export async function reconcileAccount"));
check("the upload pairs through the same tested function", /const recon = pairLines\(/.test(ingest));
check("it reuses the register already fetched for matching, not a second call",
  /\[\.\.\.zohoTxns\]\.flatMap/.test(ingest) && !/await fetchZohoBankTxnsFor[\s\S]{0,200}pairLines/.test(ingest),
  "a second call would double the Zoho traffic on every upload");
check("both counts are stored on the statement",
  /recon_missing: recon\.statementOnly\.length/.test(ingest) && /recon_extra: recon\.zohoOnly\.length/.test(ingest));
check("duplicates are reconciled too, or a re-upload orphans everything already filed",
  /lines\.map\(\(l\) => \(\{/.test(ingest),
  "the pairing must run over every line in the file, not only the newly filed ones");

// ── which way the money went ───────────────────────────────────────────────
// The bug his screenshots exposed on 2 September. Every one of the seven
// "entries in Zoho with no bank line behind it" was the exact mirror of a
// statement line — same date, same amount, opposite sign — because
// debit_or_credit was read from the bank's side instead of the books'. The
// bank account is an asset: a DEBIT to it is money IN.
check("a debit to the bank ledger is money in",
  /dc === "debit" \? "in" : "out"/.test(bank),
  "reading it the other way turns every reconciled line into a false finding");
check("Zoho's own transaction_type wins where it is unambiguous",
  /IN_TYPES\.has\(tt\)/.test(bank) && /OUT_TYPES\.has\(tt\)/.test(bank));
check("a withdrawal is money out and a deposit is money in",
  /OUT_TYPES = new Set\(\[[^\]]*"withdrawal"/.test(bank) &&
  /IN_TYPES = new Set\(\[[^\]]*"deposit"/.test(bank));
check("a vendor payment is money out, not in",
  /OUT_TYPES = new Set\(\[[^\]]*"vendor_payment"/.test(bank) &&
  !/IN_TYPES = new Set\(\[[^\]]*"vendor_payment"/.test(bank));

// A statement line and the Zoho entry our own posting made from it must pair.
{
  const r = pairLines(
    [S("2026-08-31", 150000, "out", "SAK/CASH WDL/SELF", "posted")],
    [Z("2026-08-31", 150000, "out", "", "journal")],
  );
  check("a cash withdrawal we posted ourselves reconciles, it is not a finding",
    r.matched === 1 && !r.statementOnly.length && !r.zohoOnly.length);
}

// ── the rate, when a rupee payment settles a foreign bill ──────────────────
const settle = readFileSync(join(import.meta.dirname, "..", "lib/bankSettle.ts"), "utf8");
check("a foreign document cannot be settled without a rate",
  /if \(foreign && !\(Number\(p\.exchangeRate\) > 0\)\)/.test(settle),
  "applying 103440 against a bill that owes $1,200 is nonsense, not a rounding argument");
check("the amount applied is converted into the document's currency",
  /const amount = Number\(\(p\.amount \/ rate\)\.toFixed\(2\)\)/.test(settle));
check("the rate goes on the payment so Zoho can work out its own difference",
  /exchange_rate: rate/.test(settle));
check("documents in two currencies are not settled together",
  /different currencies/.test(settle));
check("the overpayment guard speaks in the document's currency",
  /at \$\{rate\} per \$\{currency\}/.test(settle));
check("the rate reaches the settlement from the line",
  /exchangeRate: l\.fx_rate/.test(bank));

// ── the suggestion is answerable where it is found ─────────────────────────
check("each unbooked line carries the ledger and sub-ledger panel",
  /<BankAnswerPanel[\s\S]{0,400}suggestPattern\(String\(row!\.narration\)\)/.test(page),
  "a list of what is missing is a report; he asked for suggestions he can act on");
check("and the choice of which bill or invoice it settles",
  /action=\{chooseMatchAction\}[\s\S]{0,900}name="doc_id"/.test(page));
check("the rate is asked for only when a foreign document is on offer",
  /cands\.some\(\(c\) => \(c\.currency \?\? "INR"\) !== "INR"\)/.test(page));
check("a line already posted is not offered for posting again",
  /const settled = row && \(row\.status === "posted" \|\| row\.status === "matched"\)/.test(page),
  "that is a discrepancy to look at in Zoho, not an entry to make twice");

// ── the sub-ledger is an account, not a phrase ─────────────────────────────
// "I asked a sub ledger. It was there but posting was not made in sub ledger.
//  You just posted it in the narration name. The account name was drawings and
//  sub ledger name is donation." — 2 September 2026.
check("a sub-ledger becomes a real Zoho sub-account of the head",
  /parent_account_id: parent\.id/.test(bank),
  "written into the description alone, nothing can total it");
check("it takes the parent's own type — a sub-account of Drawings is equity",
  /account_type: parent\.type/.test(bank));
check("an existing child of that parent is reused, not duplicated",
  /mine\.find\(\(a\) => a\.account_name\.trim\(\)\.toLowerCase\(\) === want\.toLowerCase\(\)\)/.test(bank));
check("a child of some OTHER parent is never borrowed",
  /String\(a\.parent_account_id \?\? ""\) === parent\.id/.test(bank),
  "two heads can both have a 'Delhi office'");
check("the bank line posts to the sub-ledger it resolved",
  /other = await zohoSubAccount\(accountChoice, subName\)/.test(bank));
check("failing to make the sub-ledger does NOT quietly post to the parent",
  /has NOT been posted to \$\{parentName\} on its own/.test(bank),
  "that is the behaviour being complained about");
const bills = readFileSync(join(import.meta.dirname, "..", "lib/providerBills.ts"), "utf8");
check("a supplier bill posts to its sub-ledger too, same fault same fix",
  /accountId = \(await zohoSubAccount\(String\(p\.expense_account\), String\(b\.sub_account\)\)\)\.id/.test(bills));

// ── posting again what Zoho lost ───────────────────────────────────────────
const acts = readFileSync(join(import.meta.dirname, "..", "app/admin/zoho/actions.ts"), "utf8");
const repost = acts.slice(acts.indexOf("export async function repostLineAction"));
check("Zoho is asked again at the press, not trusted from the page",
  /await zohoHasEntryFor\(String\(l\.account_name\)/.test(repost),
  "the page may have been open an hour; the risk is booking the same money twice");
check("if the entry IS there, nothing is reopened",
  /if \(present\) \{[\s\S]{0,200}status: "matched"/.test(repost));
check("a failed lookup refuses rather than reopens",
  /could not check Zoho just now — not reopened/.test(repost),
  "reopening on a failed check is exactly how a payment gets made twice");
check("only a posted or matched line can be reopened at all",
  /l\.status !== "posted" && l\.status !== "matched"/.test(repost));
check("it comes back with the answer it already had",
  /status: hasProposal \? "auto" : "ask"/.test(repost));

// ── one route to a Razorpay deposit, not two ───────────────────────────────
// "remove razorpay clearing since bank statement already includes" — 2 Sep.
// All 114 settlements carry a zero fee, so the journal this queue made was
// Dr bank / Cr Razorpay Clearing: the same entry the bank line already posts.
// Two routes double-counted twice in a fortnight (25 Aug ₹15,411, 1 Sep
// ₹45,456), because the statement was uploaded before the settlement was
// released and neither could see the other.
const settlements = readFileSync(join(import.meta.dirname, "..", "lib/zohoSettlements.ts"), "utf8");
check("nothing is ever queued for posting from a settlement again",
  !/status: "draft"/.test(settlements),
  "a draft is the thing that gets approved and posted");
check("posting a settlement is refused outright, not merely unreachable",
  /throw new Error\(`settlements are no longer posted from here/.test(settlements),
  "an approval raised before the change must not go through after it");
check("an old draft left in the table is stood down, not left postable",
  /\.in\("status", \["draft", "unverified"\]\)/.test(settlements));
check("the scan still records what Razorpay says, as a cross-check",
  /status: "record"/.test(settlements));
check("a settlement that DOES carry a fee is called out — the bank cannot show it",
  /carry a Razorpay fee, which the bank statement cannot show/.test(settlements),
  "if Razorpay ever starts netting its charges, the fee needs booking separately");
check("the settlements section no longer offers approval",
  !/approveAllSettlementsAction/.test(page.slice(page.indexOf('id="settlements"'), page.indexOf('id="settlements"') + 4000)),
  "a button that posts is the whole problem");

console.log(fails === 0 ? "ok — bank reconciliation" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
