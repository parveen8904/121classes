// What counts as "still waiting" on the doubt report.
//
// The first version of this counted a doubt as unanswered whenever no paired
// reply row existed. That said 46 were waiting when 6 were: login-help requests
// are settled automatically and marked answered without a reply row, and
// replies written before the pairing existed have none either. A number that
// overstates by 8× is worse than no number, because the page gets ignored.
//
//   node --experimental-strip-types tests/doubtWaiting.test.ts

type Row = { id: string; status: string; created_at: string };

// Mirrors app/admin/doubt-log/page.tsx. The last check keeps them in step.
function classify(rows: Row[], repliesFor: Set<string>) {
  const isDone = (q: Row) =>
    repliesFor.has(q.id) || q.status === "answered" || q.status === "replied";
  return {
    done: rows.filter(isDone).length,
    waiting: rows.filter((q) => !isDone(q) && q.status === "open").length,
  };
}

let fails = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) return;
  fails++;
  console.error(`FAIL  ${name}\n      got  ${a}\n      want ${b}`);
};

const r = (id: string, status: string): Row => ({ id, status, created_at: "2026-08-09T00:00:00Z" });

// The real shape of the 30-day window on 9 Aug 2026.
const rows: Row[] = [
  ...Array.from({ length: 17 }, (_, i) => r(`login${i}`, "answered")),   // handled automatically
  ...Array.from({ length: 14 }, (_, i) => r(`email${i}`, "replied")),    // replied, no paired row
  ...Array.from({ length: 6 }, (_, i) => r(`wa${i}`, "replied")),        // answered by hand today
  ...Array.from({ length: 3 }, (_, i) => r(`tg${i}`, "answered")),
  ...Array.from({ length: 4 }, (_, i) => r(`open${i}`, "open")),         // genuinely need a person
  ...Array.from({ length: 2 }, (_, i) => r(`waOpen${i}`, "open")),       // unreachable pair
];

check("only the open ones are waiting", classify(rows, new Set()), { done: 40, waiting: 6 });

// A paired reply settles it whatever the status says.
check("a reply row settles an open row",
  classify([r("a", "open")], new Set(["a"])), { done: 1, waiting: 0 });

// Chatter that was closed is neither answered nor waiting.
check("closed chatter is not waiting",
  classify([r("a", "done"), r("b", "ignored")], new Set()), { done: 0, waiting: 0 });

check("nothing at all", classify([], new Set()), { done: 0, waiting: 0 });

// Guard against the page drifting back to the counting that overstated by 8×.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const src = readFileSync(join(import.meta.dirname, "..", "app/admin/doubt-log/page.tsx"), "utf8");
check("the page still treats answered/replied as done",
  /q\.status === "answered" \|\| q\.status === "replied"/.test(src), true);
check("the page still requires status open to call it waiting",
  /!isDone\(q\) && q\.status === "open"/.test(src), true);

console.log(fails === 0 ? "PASS  waiting means waiting: 6 of 46, not 46" : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
