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
const page = readFileSync(join(import.meta.dirname, "..", "app/admin/zoho/page.tsx"), "utf8");
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

console.log(fails === 0 ? "ok — bank reconciliation" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
