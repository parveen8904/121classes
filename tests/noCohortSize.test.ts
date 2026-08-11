import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// NEVER TELL A STUDENT HOW MANY OTHER STUDENTS THERE ARE.
//
// The performance page said "🏅 Better than 50% of students (2 took it)". Two
// things wrong with that, and the second is the one that matters:
//
//   · it turns an achievement into a joke — better than one other person;
//   · it tells anybody reading it exactly how big the school is, on a page
//     every student can see, at a moment when the honest answer is "small".
//
// How many students we have is ours. It does not go on a student's screen, a
// public page, an email or a certificate, whatever it happens to be that week.
// This is a standing instruction, and standing instructions decay quietly, so
// it is a test rather than a comment.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
const root = join(import.meta.dirname, "..");

// Student-facing surfaces only. The admin side is his own screen and SHOULD
// show real counts — that is the whole point of a report.
const WATCHED = ["app/learn", "app/dashboard", "app/planner", "app/results", "app/inbox"];
const files: string[] = [];
for (const dir of WATCHED) {
  const abs = join(root, dir);
  try { statSync(abs); } catch { continue; }
  (function walk(d: string) {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  })(abs);
}
check(files.length > 0, "there are student-facing files to check");

// The phrasings that leak a headcount next to a rank.
const LEAKS: [RegExp, string][] = [
  [/\$\{[^}]*\.length[^}]*\}\s*(took|sat|attempted|wrote)\b/i, "a cohort size interpolated beside took/sat"],
  [/\(\s*\{[^}]*\.length[^}]*\}\s*(took|sat|students|people)/i, "a bracketed count of students"],
  [/\b(took it|sat it|attempted it)\b/i, "the words \"took it\" / \"sat it\" — these followed a number"],
  [/\{[^}]*\blength\b[^}]*\}\s*(students|people)\b/i, "a rendered count of students or people"],
  [/out of \{[^}]*\.length/i, "\"out of N\" where N is a cohort size"],
];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  // Comments explain WHY the rule exists and must not trip it.
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  for (const [re, why] of LEAKS) {
    if (re.test(code)) {
      fails++;
      console.log(`FAIL  ${file.replace(root, ".")} — ${why}`);
    }
  }
}

// And the rank itself must be withheld until the group is big enough, so a
// small cohort cannot be inferred from a suspiciously round percentage.
const perf = readFileSync(join(root, "app/learn/performance/page.tsx"), "utf8");
check(/MIN_COHORT\s*=\s*(\d+)/.test(perf), "the performance page defines a minimum cohort");
const min = Number(perf.match(/MIN_COHORT\s*=\s*(\d+)/)?.[1] ?? 0);
check(min >= 5, `the minimum is at least 5 (got ${min}) — a rank out of two is not a rank`);
check((perf.match(/MIN_COHORT/g) ?? []).length >= 4,
  "every percentile on the page is gated by it, not just the first");

console.log(fails === 0 ? "PASS  no student screen reveals how many students there are" : "");
process.exit(fails === 0 ? 0 : 1);
