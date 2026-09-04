// The 4 September batch: subscriptions, the dashboard tally, pagination, GST.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const enrol = readFileSync("app/admin/enrolment/actions.ts", "utf8");
const enrolPage = readFileSync("app/admin/enrolment/page.tsx", "utf8");
const users = readFileSync("app/admin/courses/[courseId]/users/page.tsx", "utf8");

/* ── 3. an operator's write must actually happen ─────────────────────────── */

check("no subscription write goes through the cookie client",
  !/const supabase = createClient\(\);/.test(enrol),
  "RLS on subscriptions admits only role = 'admin', so an operator's update matched no rows and reported success");
check("extend uses the service client",
  /const supabase = createServiceClient\(\);[\s\S]{0,400}\.from\("subscriptions"\)[\s\S]{0,200}ends_at/.test(enrol));
check("revoke does too", /createServiceClient\(\)\.from\("subscriptions"\)\.update\(\{ status: "cancelled"/.test(enrol));
check("a refused extension is no longer reported as done",
  /if \(error\) \{[\s\S]{0,200}The extension was not saved/.test(enrol),
  "the whole fault was a silent no-op wearing a success message");
check("the extension still runs on from the CURRENT expiry",
  /extendedEndsAt\(\(sub\?\.ends_at as string \| null\) \?\? null, months\)/.test(enrol),
  "it must not start from the day it was added");

/* ── 2. an extension added wrongly can be corrected ──────────────────────── */

check("there is a way to set the expiry outright",
  /export async function setSubscriptionEnd\(/.test(enrol));
check("it is on the row", /action=\{setSubscriptionEnd\}/.test(enrolPage));
check("the box opens on the expiry the student has now",
  /defaultValue=\{s\.ends_at \? String\(s\.ends_at\)\.slice\(0, 10\) : ""\}/.test(enrolPage),
  "so the correction is checked against what it replaces");
check("a bad date is refused rather than saved",
  /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(ends\)/.test(enrol));
check("the new expiry covers the whole of that day",
  /T23:59:59\+05:30/.test(enrol),
  "Extend has always meant end-of-day; the two controls must not differ by a day");

/* ── 1. a subscription can be stopped ────────────────────────────────────── */

check("blocking is available and reversible",
  /export async function blockSubscription\(/.test(enrol) && /export async function restoreSubscription\(/.test(enrol));
check("a block records WHY", /blocked_reason: reason \|\| null/.test(enrol));
check("both are on the row",
  /action=\{blockSubscription\}/.test(enrolPage) && /action=\{restoreSubscription\}/.test(enrolPage));

/* ── 5. the long list is paged ───────────────────────────────────────────── */

check("registered users is fetched a page at a time",
  /\.range\(from, from \+ PER_PAGE - 1\)/.test(users),
  "it was reading every subscription on the course, then every watch row for each");
check("the headline figures are counted in the database",
  /count: "exact", head: true/.test(users),
  "they were rows.filter(...).length, which is the only reason all the rows were loaded");
check("there is a pager", /page \{current\} of \{pages\}/.test(users));
check("‘never opened a class’ is still asked across the whole course",
  /neverOpened = Math\.max\(0, \(activeCount \?\? 0\) - watchers\.size\)/.test(users),
  "it must not quietly become 'nobody on page 3'");

/* ── 6. GST verification is gone ─────────────────────────────────────────── */

for (const f of ["app/components/ProfileAddressBlock.tsx", "app/components/CheckoutAddressStep.tsx", "app/gift/GiftForm.tsx"]) {
  const src = readFileSync(f, "utf8");
  check(`${f} has no Verify button`, !/"Verify"|>\s*Verify\s*</.test(src));
  check(`${f} does not call verifyGstin`, !/verifyGstin/.test(src));
  check(`${f} still collects the GST number`, /gstin/i.test(src), "the invoice still needs it");
}

console.log(fails ? `${fails} failed` : "ok — enrolment, dashboard, pagination, GST");
process.exit(fails ? 1 : 0);
