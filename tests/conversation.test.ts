// The thread handed to an answer must not include the question being answered.
//
// WhatsApp records an inbound message BEFORE the reply is written; Telegram
// records it AFTER. So the same "drop the last student line" rule is right on
// one channel and eats a real turn of history on the other — and a lost turn is
// exactly what made us ask a student their course three times.
//
// dropCurrent is the whole fix, so it is the thing tested. The query around it
// needs a database; this does not.
//
//   node --experimental-strip-types tests/conversation.test.ts

type Row = { who: "student" | "us"; text: string };

// Mirrors lib/conversation.ts. Kept in step by the last check in this file.
function dropCurrent(rows: Row[], current: string): Row[] {
  const want = (current ?? "").trim();
  if (!want) return rows;
  const last = rows[rows.length - 1];
  if (last && last.who === "student" && last.text.trim() === want) return rows.slice(0, -1);
  return rows;
}

let fails = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) return;
  fails++;
  console.error(`FAIL  ${name}\n      got  ${a}\n      want ${b}`);
};

const S = (text: string): Row => ({ who: "student", text });
const U = (text: string): Row => ({ who: "us", text });

// WhatsApp: the current message is already recorded, so it must come off.
check("whatsapp — the message being answered is not quoted back",
  dropCurrent([S("Can you provide me rtp"), U("Final or Inter?"), S("Ca inter")], "Ca inter"),
  [S("Can you provide me rtp"), U("Final or Inter?")]);

// Telegram: it is NOT yet recorded, so nothing may be removed — this is the
// case that silently lost a turn before.
check("telegram — an unanswered earlier question is kept",
  dropCurrent([S("Can you provide me rtp"), U("Final or Inter?")], "Ca inter"),
  [S("Can you provide me rtp"), U("Final or Inter?")]);

// A repeated question must not strip the earlier identical one.
check("only the trailing copy goes",
  dropCurrent([S("hitlist"), U("Which course?"), S("hitlist")], "hitlist"),
  [S("hitlist"), U("Which course?")]);

// Whitespace differences must not defeat the match.
check("matched despite stray spacing",
  dropCurrent([U("Which course?"), S("  Ca inter ")], "Ca inter"),
  [U("Which course?")]);

// Our own last line is never removed.
check("an answer at the end stays",
  dropCurrent([S("hitlist"), U("It is at /learn/hitlist")], "something else"),
  [S("hitlist"), U("It is at /learn/hitlist")]);

check("empty history stays empty", dropCurrent([], "anything"), []);
check("no current message changes nothing",
  dropCurrent([S("hi")], ""), [S("hi")]);

// The copy above must not drift from the real one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const src = readFileSync(join(import.meta.dirname, "..", "lib/conversation.ts"), "utf8");
check("lib/conversation.ts still matches on text, not position",
  /last\.who === "student" && last\.text\.trim\(\) === want/.test(src), true);

console.log(fails === 0 ? "PASS  conversation history excludes the current message on both channels" : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
