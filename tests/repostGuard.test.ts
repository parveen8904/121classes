// THE GUARD THAT COULD NEVER FIRE.
//
// Found in the Zoho audit of 3 September 2026, on a real line: the ₹27,505.64
// Supabase refund of 24 August had been approved three times — 1, 2 and 3
// September — and reopened each time with "the entry was deleted in Zoho".
//
// repostLineAction reopens a POSTED line when Zoho says the entry is not there,
// and it carries this comment about the case where Zoho cannot be read:
//
//   "Refusing is the safe answer: reopening on a failed lookup is exactly how
//    a payment gets made twice."
//
// The comment is right and the branch was unreachable. zohoHasEntryFor called
// fetchZohoBankTxnsFor, which caught every error and returned an EMPTY
// register — so a throttled minute, a refreshed token or a timeout came back
// as "the entry is gone", indistinguishable from the truth. The line was
// reopened and posted again. That is a mechanism for booking the same money
// twice, sitting behind a comment saying it must not happen.
//
// A second way into the same hole: the lookup asked the register for the
// direction implied by the debit/credit COLUMNS, while the posting follows the
// direction the desk chose. Since 3 September those can differ — the two
// ₹6,900 receipts were corrected by hand — so a corrected line would be looked
// for on the wrong side, never found, and reopened.
//
//   node --experimental-strip-types tests/repostGuard.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
const bank = read("lib/bankStatements.ts");
const actions = read("app/admin/zoho/actions.ts");

/* ── "could not look" is not "not there" ─────────────────────────────────── */

const fetcher = bank.slice(bank.indexOf("async function fetchZohoBankTxnsFor"));
const fetcherBody = fetcher.slice(0, fetcher.indexOf("async function fetchZohoExpensesFor"));

check("the register fetch reports whether it could actually read Zoho",
  /Promise<\{ map: Map<string, ZTxn\[\]>; ok: boolean \}>/.test(fetcherBody),
  "an empty map returned on failure is indistinguishable from an empty register");

check("…and does not go on swallowing the failure silently",
  /ok = false;/.test(fetcherBody) && !/catch \{ \/\* matching is best-effort; unmatched lines simply ask \*\/ \}/.test(fetcherBody));

const has = bank.slice(bank.indexOf("export async function zohoHasEntryFor"));
const hasBody = has.slice(0, has.indexOf("export async function reconcileAccount"));

check("zohoHasEntryFor THROWS when Zoho could not be read",
  /if \(!ok\) throw new Error/.test(hasBody),
  "its only caller reopens a posted line on false, so false must mean 'not there', never 'I could not tell'");

check("it still answers plainly when Zoho WAS read",
  /return \(map\.get\(/.test(hasBody));

/* ── the reopen decision itself ──────────────────────────────────────────── */

const repost = actions.slice(actions.indexOf("export async function repostLineAction"));
const repostBody = repost.slice(0, repost.indexOf("export async function retryLineAction"));

check("a failed lookup does not reopen the line",
  /catch \{[\s\S]{0,700}not reopened/.test(repostBody),
  "this branch existed all along and could not be reached");

check("the line is only reopened when Zoho positively says the entry is gone",
  /if \(present\)[\s\S]{0,400}status: "matched"/.test(repostBody));

check("the lookup follows the direction the desk chose, not the parsed columns",
  /String\(l\.direction \?\? ""\)/.test(repostBody) && /chosen === "in" \|\| chosen === "out"/.test(repostBody),
  "a corrected line searched on the wrong side is never found, and is then posted a second time");

check("…and it selects that column to be able to",
  /\.select\("id, account_name, line_date, debit, credit, status, proposal, direction"\)/.test(repostBody));

check("the amount is a magnitude, like everywhere else",
  /Math\.abs\(debit\) \|\| Math\.abs\(credit\)/.test(repostBody));

/* ── reconciliation must not call an unread period a difference ──────────── */

check("a reconciliation that could not read Zoho says so instead of reporting every line missing",
  /problem: !zohoOk/.test(bank),
  "reporting a whole period as unbooked because the hub was throttled is worse than admitting the question went unanswered");

console.log(fails === 0 ? "ok — re-post guard" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
