// The petty cash page that emptied itself.
//
// His report, 2 September 2026, three things at once:
//
//   "the message that the person is already existing is shown [in the] sales
//    line on same page"
//   "the person that have already been created [are] not shown... earlier you
//    were showing the person, the advance given, advance adjusted, submitted
//    for approval and the closing balance, but now you have removed it"
//   "when we want to make a payment [to] a person who is already existing, you
//    say pick the person, but when we pick the person it says no one existing
//    though the persons are already existing"
//
// The second and third were ONE fault. On 1 September the balances query began
// asking for each person's login email as an embedded row, profiles(email).
// PostgREST resolves an embed through a FOREIGN KEY, and petty_people never had
// one to profiles. The query failed, data came back null, the list became an
// empty array, and both the balances and the person picker went blank while
// three people sat in the table. Nothing had been "removed".
//
//   node --experimental-strip-types tests/pettyCashList.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};
const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── the list must not depend on a decoration ──────────────────────────────
const petty = read("lib/pettyCash.ts");
check("the people are read without an embedded join",
  /\.from\("petty_people"\)\.select\("id, name, zoho_account_name, profile_id"\)/.test(petty),
  "an optional nicety must never be able to take the essential list with it");
check("no embed is left anywhere in the balances query",
  !/profiles\(email\)/.test(petty.replace(/\/\/[^\n]*/g, "")));
check("the emails are a separate query whose failure costs only the emails",
  /\.from\("profiles"\)\.select\("id, email"\)\.in\("id", profileIds\)/.test(petty));
check("a broken people query is thrown, not silently emptied",
  /if \(peopleErr\) throw new Error/.test(petty),
  "‘nobody is set up yet’ and ‘the query broke’ look identical on screen");

// ── and the page must say so rather than showing an empty list ────────────
const page = read("app/admin/zoho/page.tsx");
check("the page no longer swallows the failure to an empty array",
  !/pettyBalances\(\)\.catch\(\(\) => \[\]\)/.test(page),
  "that is how a failed query came to look like ‘nobody has been added yet’");
check("it captures the reason", /catch \(e\) \{ pettyErr = e instanceof Error/.test(page));
check("and shows it where the people would have been",
  /this is a fault, not an empty list/.test(page));

// ── the foreign key that was missing ──────────────────────────────────────
const migration = read("supabase/migrations/0058_petty_people_profile_fk.sql");
check("the relationship is written down",
  /foreign key \(profile_id\) references public\.profiles\(id\)/.test(migration));
check("deleting a login never deletes a petty cash ledger",
  /on delete set null/.test(migration),
  "the advances and bills against it are accounting records");

// ── the message appears where the work was done ───────────────────────────
const actions = read("app/admin/zoho/actions.ts");
for (const sec of ["petty", "bank", "bills", "brokerage"]) {
  const hashes = (actions.match(new RegExp(`#${sec}\``, "g")) ?? []).length;
  const tagged = (actions.match(new RegExp(`&sec=${sec}#${sec}\``, "g")) ?? []).length;
  check(`every ${sec} message names its section`, hashes > 0 && hashes === tagged,
    `${tagged} of ${hashes} tagged — the hash never reaches the server, so it cannot place the message`);
}
check("the page reads the section back", /const deskSec = \(sp\.sec \?\? ""\)\.trim\(\)/.test(page));
check("and draws the message inside that section",
  (page.match(/<DeskNotice sec="/g) ?? []).length >= 6);
check("a refusal is not dressed as a success",
  /deskBad \? "notice err" : "notice ok"/.test(page),
  "‘This email ID is already registered’ was shown in green, in the sales section");
check("‘already’ reads as a refusal", /already\|could not\|cannot\|failed/.test(page));
check("the sales banner keeps only its own messages",
  /deskMsg && !deskSec &&/.test(page),
  "it used to catch every message from every section on the page");

// ── a failed bill is still a bill to approve ──────────────────────────────
//
// "Ravi has already submitted some invoices, but there is no way to approve
//  it." — 2 September. His three FR book bills (₹1,495, ₹1,399, ₹2,248) were
// approved by the desk on 29 August, hit the founder's gate — "POST /journals
// would change the books in Zoho" — and landed as `failed`. All the row then
// offered was "↻ Back to pending": two presses to do one thing, with a label
// that reads like a dead end.
check("the approve form is on every bill row, not only the pending ones",
  !/\{b\.status === "pending" \? \(/.test(page),
  "a failed bill is the one that most needs approving again");
check("the head the desk already chose comes back with it",
  /defaultValue=\{b\.expense_account \?\? ""\}/.test(page));
check("the button says what it does on a failed row",
  /b\.status === "failed" \? "✅ Approve again"/.test(page));
check("and the row explains why it failed and what approving now does",
  /Approving it now queues it there properly/.test(page));
check("the two-step retry is gone",
  !/retryBillAction/.test(page) && /retryBillAction is gone/.test(actions),
  "‘Back to pending’ was a label nobody could read as ‘approve this’");
check("approving still goes through the founder's gate, never straight to Zoho",
  /requestApprovalFor\("petty_bill", "petty_bills", id, \{ expenseAccount \}/.test(actions));

// ── and an unposted advance is no longer invisible ───────────────────────
check("pending advances are read, not just failed ones",
  /\.in\("status", \["failed", "pending"\]\)/.test(page),
  "Ravi's duplicate ₹600 from 27 August showed on no screen at all");
check("a pending advance says it does not count in the balance",
  /It does NOT count in the balance below/.test(page),
  "only posted advances are counted, which is why it was invisible AND uncounted");
check("it can be removed when it was never real",
  /action=\{rejectAdvanceAction\}/.test(page));
check("but a POSTED advance can never be quietly deleted",
  /reverse it there with a journal, not by deleting the record here/.test(actions),
  "the way to undo something in Zoho is another entry");

console.log(fails === 0 ? "ok — petty cash list" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
