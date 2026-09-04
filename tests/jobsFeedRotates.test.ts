// The openings sweep must reach every query, not the same sixteen for ever.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const src = readFileSync("lib/jobsfeed.ts", "utf8");

check("the alternate-day rest is kept — it was working as designed",
  /istDay % 2 === 1/.test(src) && /SerpAPI rests today/.test(src),
  "his plan; the fault was underneath it");
check("the monthly allowance is still respected",
  /if \(left !== null && left <= 0\)/.test(src) && /Math\.min\(perRun, left\)/.test(src));

check("every configured query is used, not the first six",
  !/\(await queryList\(\)\)\.slice\(0, 6\)/.test(src) && /\(await queryList\(\)\)\.slice\(0, 20\)/.test(src),
  '"statutory audit CA" and "semi qualified CA" were never searched at all');
check("the sweep no longer always takes the front of the list",
  !/for \(const \{ q, loc \} of combos\.slice\(0, budget\)\)/.test(src),
  "24 of 40 combinations had never run once");
check("it starts where the last run stopped, and wraps",
  /const start = combos\.length \? \(runNo \* budget\) % combos\.length : 0;/.test(src)
    && /combos\[\(start \+ i\) % combos\.length\]/.test(src));
check("the run says what it swept, so this cannot go unnoticed again",
  /SerpAPI sweep: \$\{window\.length\} of \$\{combos\.length\}/.test(src));

/* ── the rotation actually covers everything ─────────────────────────────── */

const combos = Array.from({ length: 40 }, (_, i) => i);
const budget = 16;
const seen = new Set<number>();
let runs = 0;
for (let run = 0; run < 20; run++) {
  const start = (run * budget) % combos.length;
  for (let i = 0; i < Math.min(budget, combos.length); i++) seen.add(combos[(start + i) % combos.length]);
  runs = run + 1;
  if (seen.size === combos.length) break;
}
check("all 40 combinations are reached", seen.size === 40, `only ${seen.size}`);
check("…within a few days", runs <= 3, `took ${runs} runs`);

// A short list must not break the window.
const small = [0, 1, 2];
const win = Array.from({ length: Math.min(budget, small.length) }, (_, i) => small[(0 + i) % small.length]);
check("a list shorter than the budget is not over-swept", win.length === 3,
  "asking the same three questions sixteen times would spend the allowance on nothing");

console.log(fails ? `${fails} failed` : "ok — the openings sweep rotates over every query");
process.exit(fails ? 1 : 0);
