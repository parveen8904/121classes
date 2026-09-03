// THE HAND THAT ASKS IS NOT THE HAND THAT RELEASES.
//
// His report, 3 September 2026:
//
//   "it gets approved automatically when it is clicked in petty cash tile, but
//    if we want that it should go to the waiting for approval section, and then
//    only it should go to zoho"
//
// It was not automatic. It was worse: the accounts desk (accounts@aldine.edu.in,
// an operator holding both `zoho` and `zoho_approve`) pressed ✅ Approve on a
// petty-cash bill, which filed a request AND redirected to the gate — where the
// very same login could release it. Five postings reached Zoho that way,
// requested and released by one person seconds apart. The founder never saw
// them.
//
// A gate the requester can open is not a gate. These check the rule that
// replaced it, and the two exceptions that must survive:
//
//   · the FOUNDER may release his own — he is the final authority and there is
//     nobody above him to countersign
//   · a request with NO requester (a cron, a webhook) blocks nobody
//
//   node --experimental-strip-types tests/twoHandsApproval.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
const approvals = read("lib/zohoApprovals.ts");
const actions = read("app/admin/zoho/actions.ts");
const gate = read("app/admin/zoho/approvals/page.tsx");

/* ── the rule itself ─────────────────────────────────────────────────────── */

// The guard has to live in releaseApproval, not in a page or an action: that
// is the ONLY path to Zoho, and the drain cron goes through it too. Anywhere
// else and there is a way round it.
const release = approvals.slice(approvals.indexOf("export async function releaseApproval"));
check("releaseApproval compares the releaser with the requester",
  /row\.requested_by[\s\S]{0,120}String\(row\.requested_by\) === String\(decidedBy\)/.test(release),
  "the check must sit on the one path that opens the gate, or it can be walked around");

check("…and lets it through when the releaser is the founder",
  /role[\s\S]{0,120}!== "admin"/.test(release),
  "the founder has nobody above him to countersign; blocking him jams the desk");

check("a refusal leaves the request PENDING, not failed",
  release.indexOf("SELF_REQUEST_NOTE") < release.indexOf("const run = EXECUTORS"),
  "it returns before anything is executed or any status is written");

check("the refusal is a named constant, so callers can tell it from a fault",
  /export const SELF_REQUEST_NOTE/.test(approvals) && /export const isSelfRequest/.test(approvals));

/* ── who asked has to be recorded, or the rule guards nothing ───────────── */

check("requestApprovalFor fills in the requester when the caller does not",
  /let who = requestedBy \?\? null;[\s\S]{0,400}currentStaff\(\)\)\?\.id/.test(approvals),
  "thirteen of fifteen call sites passed nothing, so requested_by was null and the rule would never fire");

check("a cron or webhook with no logged-in user stays null rather than throwing",
  /try \{[\s\S]{0,220}currentStaff[\s\S]{0,120}\} catch \{ who = null; \}/.test(approvals));

/* ── the desk is no longer dropped onto the release button ───────────────── */

const pettyBill = actions.slice(actions.indexOf("export async function approveBillAction"));
const pettyBillBody = pettyBill.slice(0, pettyBill.indexOf("export async function rejectBillAction"));
check("approving a petty bill returns to petty cash, not to the gate",
  /redirect\("\/admin\/zoho\/petty\?scan=/.test(pettyBillBody) && !/redirect\("\/admin\/zoho\/approvals/.test(pettyBillBody),
  "landing on the gate with the item you just sent, beside a release button, is how one decision became two clicks in one motion");

const advance = actions.slice(actions.indexOf("export async function recordAdvanceAction"));
check("…and so does recording an advance",
  /redirect\("\/admin\/zoho\/petty\?scan=/.test(advance.slice(0, 2000)));

check("both say the posting happens only on release",
  (pettyBillBody.match(/posts to Zoho when he releases it/) ?? []).length === 1);

/* ── and the gate does not offer a button it will refuse ─────────────────── */

check("the gate works out whether this person may release each request",
  /const mayRelease = \(requestedBy/.test(gate));
check("the per-item Approve button is not drawn on your own request",
  /mayRelease\(a\.requested_by\) \? \([\s\S]{0,400}approveZohoAction/.test(gate),
  "a button whose only purpose is to tell you off is worse than no button");
check("‘Approve all’ excludes the ones you asked for",
  /pendingApprovals\.filter\(\(a\) => mayRelease\(a\.requested_by\)\)\.map/.test(gate));
check("the gate names who asked",
  /asked by \{a\.requested_by_name\}|asked by/.test(gate));

/* ── the bulk release must not call it a failure ─────────────────────────── */

const all = actions.slice(actions.indexOf("export async function approveAllZohoAction"));
check("a self-request is counted apart from things that genuinely failed",
  /isSelfRequest\(r\)\) mine\+\+/.test(all),
  "counting it as a failure sends somebody hunting for a fault in a perfectly good request");

console.log(fails === 0 ? "ok — two hands on the gate" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
