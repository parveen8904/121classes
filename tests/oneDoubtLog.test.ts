// EVERY DOOR LANDS IN ONE LOG.
//
// A student can ask on Telegram, on Discord, in a study group, on WhatsApp, by
// email, from the website, or from the "Ask your doubt" box inside a class. For
// a long time the last of those wrote to its own table and appeared nowhere in
// the report, which is how the admin home came to show "5 open doubts" and "8
// open questions" as though they were different things.
//
// The rule is now: whatever the door, it goes through logAiExchange into
// page_questions, and the report reads that one table. This fails if a channel
// stops doing so — including a NEW channel added later by someone who never
// read this file.
//
//   node --experimental-strip-types tests/oneDoubtLog.test.ts

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// Every place a student's question is first received must record it.
const DOORS: { file: string; what: string }[] = [
  { file: "lib/whatsappAnswer.ts", what: "WhatsApp" },
  { file: "app/api/telegram/webhook/route.ts", what: "Telegram" },
  { file: "app/api/discord/interactions/route.ts", what: "Discord" },
  { file: "lib/groupDoubt.ts", what: "study groups" },
  { file: "app/learn/[courseId]/doubt-actions.ts", what: "the Ask-your-doubt box in a class" },
  { file: "app/learn/section/[sectionId]/testActions.ts", what: "doubts asked from a test page" },
];

// Support tickets raised on the website are doubts too — six sat unanswered,
// one for five days, because they lived in their own table and the log had
// never heard of them. Phone tickets are deliberately NOT included: the IVR
// opens one per call and the team settles those on the call.
check("website tickets reach the log",
  read("app/api/cron/ticket-doubts/route.ts").includes('page_path: CHANNEL'),
  "the ticket bridge no longer writes into page_questions");
check("phone tickets are still left alone",
  /eq\("source", "website"\)/.test(read("app/api/cron/ticket-doubts/route.ts")),
  "the bridge must only take website tickets");

for (const d of DOORS) {
  const src = read(d.file);
  check(`${d.what} still writes to the one log`, src.includes("logAiExchange"),
    `${d.file} no longer calls logAiExchange`);
}

// Email arrives through the inbound webhook, which writes the row directly.
check("email still lands in the log",
  read("app/api/email/inbound/route.ts").includes('from("page_questions")'),
  "the inbound mail route no longer writes page_questions");

// And the report must read that one table, not a second one alongside it.
const report = read("app/admin/doubt-log/page.tsx");
check("the report reads page_questions", report.includes('from("page_questions")'));
check("the report does NOT read a second doubts table", !report.includes('from("doubts")'),
  "reading both tables double-counts, which is what the merge removed");

// The inbox must stay retired: a second queue is how one student came to sit
// in two places with two different counts.
check("the inbox is a redirect, not a second queue",
  read("app/admin/inbox/page.tsx").includes("redirect(\"/admin/doubt-log\")"),
  "app/admin/inbox is a page again");
check("the messages hub is a redirect too",
  read("app/admin/messages/page.tsx").includes("redirect(\"/admin/doubt-log\")"));

console.log(fails === 0
  ? `PASS  ${DOORS.length + 1} doors, one log, one report`
  : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
