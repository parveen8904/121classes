// Where an extension starts counting.
//
// Ticket TKT-01283, 31 August 2026. Yashasvi Chaudhary bought FR in January
// 2025 with 24 months of validity, so it should run to January 2027 — and her
// dashboard showed 25 November 2026. Two faults did it: bulk grants stacked a
// second subscription starting TODAY instead of extending the one she had, and
// the duplicate guard used maybeSingle(), which returns null when it matches
// more than one row, so a third was added on top of the second.
//
// His instruction: months added to unexpired access run from the EXISTING
// EXPIRY. Only lapsed access counts from today. Same as Edmingle.
//
//   node --experimental-strip-types tests/subscriptionDates.test.ts

import { addMonths, extendedEndsAt, endsAtFromNow } from "../lib/subscriptionDates.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};
const day = (iso: string) => iso.slice(0, 10);

// ── his own worked example ──────────────────────────────────────────────────
// "if a student's validity expires on 30 September 2026 and I extend it by two
//  months on 30 August 2026, the new validity should be until 30 November 2026"
check("his example: 30 Sep + 2 months, extended on 30 Aug",
  day(extendedEndsAt("2026-09-30T00:00:00.000Z", 2, new Date("2026-08-30T12:00:00Z"))) === "2026-11-30",
  day(extendedEndsAt("2026-09-30T00:00:00.000Z", 2, new Date("2026-08-30T12:00:00Z"))));

// ── the ticket itself ───────────────────────────────────────────────────────
check("Yashasvi: Jan 2025 plus 24 months lands in Jan 2027",
  day(endsAtFromNow(24, new Date("2025-01-15T00:00:00Z"))) === "2027-01-15");
check("extending her 25 Nov 2026 by 2 months does NOT restart from today",
  day(extendedEndsAt("2026-11-25T00:00:00.000Z", 2, new Date("2026-08-31T00:00:00Z"))) === "2027-01-25",
  "an extension made early must not eat the time she had left");

// ── expired access has nothing to follow on from ────────────────────────────
check("lapsed access counts from today",
  day(extendedEndsAt("2026-01-31T00:00:00.000Z", 3, new Date("2026-08-31T00:00:00Z"))) === "2026-11-30",
  day(extendedEndsAt("2026-01-31T00:00:00.000Z", 3, new Date("2026-08-31T00:00:00Z"))));
check("a subscription with no end date counts from today",
  day(extendedEndsAt(null, 6, new Date("2026-08-31T00:00:00Z"))) === "2027-02-28");

// ── setMonth overflow, which silently gave days away ────────────────────────
check("31 January plus one month is 28 February, not 3 March",
  day(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()) === "2026-02-28",
  day(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()));
check("31 March plus one month is 30 April",
  day(addMonths(new Date("2026-03-31T00:00:00Z"), 1).toISOString()) === "2026-04-30");
check("29 February in a leap year plus twelve months is 28 February",
  day(addMonths(new Date("2024-02-29T00:00:00Z"), 12).toISOString()) === "2025-02-28");
check("a plain month keeps its day",
  day(addMonths(new Date("2026-05-15T00:00:00Z"), 6).toISOString()) === "2026-11-15");

// ── the extension must never SHORTEN what someone already has ───────────────
for (const months of [1, 2, 3, 6, 12, 24]) {
  const now = new Date("2026-08-31T00:00:00Z");
  const current = "2027-06-30T00:00:00.000Z";
  const after = new Date(extendedEndsAt(current, months, now));
  check(`+${months} months never lands before the current expiry`,
    after > new Date(current), `${after.toISOString()} vs ${current}`);
}

// ── the callers must actually use it ────────────────────────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
const actions = readFileSync(join(import.meta.dirname, "..", "app/admin/enrolment/actions.ts"), "utf8");
check("bulk grant EXTENDS an existing subscription instead of stacking one",
  /extendedEndsAt\(row\.ends_at, months\)/.test(actions),
  "bulkGrant must not insert a second row for a student who already has access");
check("the single grant no longer uses maybeSingle for the duplicate check",
  !/\.eq\("status", "active"\)[\s\S]{0,200}maybeSingle\(\)/.test(actions),
  "maybeSingle returns null when it matches more than one row — that is how three stacked up");
check("the duplicate check takes the LONGEST-running row",
  /order\("ends_at", \{ ascending: false/.test(actions));
check("extendSubscription goes through extendedEndsAt",
  /const ends = extendedEndsAt\(/.test(actions));
check("the duplicate warning carries the row id so Extend can be offered inline",
  /dupe_id: existing\.id/.test(actions));

console.log(fails === 0 ? "ok — subscription dates" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
