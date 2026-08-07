// The rule that decides what a student actually gets when a supporter sells to
// them. Kept as a runnable test because the handler it came from sits behind a
// LIVE payment gateway — there is no way to exercise it end to end without
// charging a real card, so this is where the behaviour is proved.
//
//   node --experimental-strip-types tests/planWindow.test.ts
import { planWindow } from "../lib/planWindow.ts";

const d = (x: Date) => x.toISOString().slice(0, 10);
const NOW = new Date("2026-08-07T12:00:00+05:30");
let fails = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// Sold in August for an October start — the case this was built for.
const future = planWindow("2026-10-01", 12, NOW);
check("bronze bridges today → 1 Oct", [d(future.bridge!.startsAt), d(future.bridge!.endsAt)], ["2026-08-07", "2026-10-01"]);
check("gold runs 1 Oct → 1 Oct", [d(future.paid.startsAt), d(future.paid.endsAt)], ["2026-10-01", "2027-10-01"]);
check("the student gets the FULL 12 months", Math.round((+future.paid.endsAt - +future.paid.startsAt) / 86400000), 365);
check("no uncovered day between the two", +future.bridge!.endsAt === +future.paid.startsAt, true);

// Starting today, or with no date, behaves as an ordinary sale.
check("today · no bridge", planWindow("2026-08-07", 12, NOW).bridge, null);
check("no date · no bridge", planWindow(null, 12, NOW).bridge, null);
check("no date · starts now", d(planWindow(null, 12, NOW).paid.startsAt), "2026-08-07");

// A date already gone, or nonsense, must never push the start backwards.
check("past date · starts now", d(planWindow("2026-01-01", 12, NOW).paid.startsAt), "2026-08-07");
check("past date · no bridge", planWindow("2026-01-01", 12, NOW).bridge, null);
check("bad date · starts now", d(planWindow("not-a-date", 12, NOW).paid.startsAt), "2026-08-07");

console.log(fails === 0 ? "ALL PASSED" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
