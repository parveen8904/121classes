// WHO MAY OPEN THE ZOHO GATE — AND WHO ASKED.
//
// On 3 September 2026 the accounts desk was found requesting and releasing its
// own postings: five had gone into the books that way, requested and released
// by accounts@aldine.edu.in seconds apart. I added segregation of duties —
// nobody but the founder may release their own request — and he overruled it
// the same day:
//
//   "The approval can be done by the Pradeep. Also, you have I blocked it.
//    There is some problem in that right now. Please check again."
//
// He is right, and the reason is worth writing down so nobody re-adds it out
// of tidiness. The zoho_approve grant is handed out BY NAME, to one person,
// deliberately. That grant already IS the decision about who may open the gate.
// A second rule quietly narrowing it made his own grant mean less than he had
// said it meant, and it stopped work on a Tuesday morning. A control the owner
// did not ask for, which blocks the office, is not prudence.
//
// So this file no longer guards a rule about WHO. It guards the part that
// survived, and which costs nobody anything: every request records who asked,
// and the gate says so. The record answers the question afterwards, which is
// what a record is for.
//
//   node --experimental-strip-types tests/approvalGrant.test.ts

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

/* ── the grant is the whole rule ─────────────────────────────────────────── */

const release = approvals.slice(approvals.indexOf("export async function releaseApproval"));
check("releaseApproval does NOT refuse a release by whoever asked",
  !/requested_by[\s\S]{0,160}=== String\(decidedBy\)/.test(release),
  "the founder ruled that holding zoho_approve is the whole answer — re-adding this stops the office");

check("the gate offers Approve to anyone holding the grant",
  !/mayRelease/.test(gate),
  "a row must not hide its own button on a rule that no longer exists");

check("who may approve is still decided in exactly one place",
  /const may = !!staff && \(staff\.role === "admin" \|\| staff\.permissions\.includes\("zoho_approve"\)\)/.test(actions),
  "assertMayApprove is the door; nothing else may narrow it");

/* ── but the record still says who asked ─────────────────────────────────── */

check("requestApprovalFor fills in the requester when the caller does not",
  /let who = requestedBy \?\? null;[\s\S]{0,400}currentStaff\(\)\)\?\.id/.test(approvals),
  "thirteen of fifteen call sites passed nothing, so requested_by was simply null");

check("a cron or webhook with no logged-in user stays null rather than throwing",
  /try \{[\s\S]{0,220}currentStaff[\s\S]{0,120}\} catch \{ who = null; \}/.test(approvals));

check("the pending list reads requested_by",
  /requested_at, note, requested_by/.test(approvals));
check("…and puts a name to it in one query, not one per row",
  /async function withRequesterNames/.test(approvals) && /\.in\("id", ids\)/.test(approvals));
check("the gate shows who asked",
  /requested_by_name/.test(gate));

/* ── nothing about the bulk release counts a phantom category ────────────── */

const all = actions.slice(actions.indexOf("export async function approveAllZohoAction"));
check("the bulk release counts only posted, queued and genuinely failed",
  !/isSelfRequest/.test(all) && /let done = 0, failed = 0, queued = 0;/.test(all));

console.log(fails === 0 ? "ok — who may open the gate" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
