// Which exam everyone is sitting next.
//
// 1 September 2026: the September exams finished and "September 2026" was
// written into the page text of eight files. A student landing on /mock-tests
// was offered papers for the exam they had just sat, and 242 students still
// had it saved as the attempt they were preparing for.
//
//   node --experimental-strip-types tests/attempts.test.ts

import { NEXT, APPLICABILITY, levelOf, levelWindow, levelWindowLabel, isPastAttempt }
  from "../lib/attempts.ts";

let fails = 0;
const check = (n: string, ok: boolean, why = "") => {
  if (ok) return; fails++; console.error(`FAIL  ${n}${why ? ` — ${why}` : ""}`);
};

check("CA Inter's next attempt is January 2027 — his instruction", NEXT.inter === "January 2027");
check("the Inter window starts at the next attempt", APPLICABILITY.inter.from === NEXT.inter);
check("CA Final is untouched pending his confirmation", NEXT.final === "November 2026");

check("a course called 'CA Intermediate' is inter", levelOf("CA Intermediate") === "inter");
check("a course called 'CA Final' is final", levelOf("CA Final") === "final");
check("anything else has no level", levelOf("Foundation") === null);
check("the window reads as prose",
  levelWindowLabel("CA Intermediate") === "January 2027 up to May 2028", levelWindowLabel("CA Intermediate"));
check("an unknown course has no window", levelWindow("Foundation") === null);

// ── past or not ────────────────────────────────────────────────────────────
const oct = new Date("2026-10-01T00:00:00Z");
check("September 2026 is past once October begins", isPastAttempt("September 2026", oct));
check("January 2027 is not past in October 2026", !isPastAttempt("January 2027", oct));
// The month it is sat in is NOT yet past — students write through the month.
const midSep = new Date("2026-09-15T00:00:00Z");
check("September 2026 is not 'past' during September", !isPastAttempt("September 2026", midSep));
check("May 2026 is past by September 2026", isPastAttempt("May 2026", midSep));
check("the old underscore form still parses", isPastAttempt("MAY_2026", midSep));
check("an empty attempt is not 'past' — that is a different problem",
  !isPastAttempt("", oct) && !isPastAttempt(null, oct) && !isPastAttempt(undefined, oct));
check("nonsense is not 'past' either", !isPastAttempt("soon", oct));

// ── no page may hardcode the attempt again ─────────────────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dirname, "..");
for (const f of [
  "app/mock-tests/page.tsx", "app/courses/page.tsx", "app/learn/[courseId]/page.tsx",
  "lib/mockPapers.ts", "app/admin/mock-papers/page.tsx", "app/admin/mock-papers/actions.ts",
]) {
  const src = readFileSync(join(root, f), "utf8");
  check(`${f} names no attempt of its own`, !/"September 2026"|September 2026 up to/.test(src),
    "it must read NEXT / levelWindow so one line moves the whole portal");
}

console.log(fails === 0 ? "ok — attempts" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
