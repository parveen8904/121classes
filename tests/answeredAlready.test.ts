// One question, one answer.
//
// 30-31 August 2026, the CA Intermediate group. A student sent the same
// photographed sum twice and the bot wrote the whole solution out twice —
// Question 40 at 18:58 and again at 19:00, Question 36 at 16:02 and again at
// 16:14. Two full worked answers each, minutes apart, in a room of 1,318.
//
// The caption on those messages was just "@caparveensharmabot", so words alone
// could never have told them apart. Telegram's file_unique_id could.
//
//   node --experimental-strip-types tests/answeredAlready.test.ts

import { answerKey, normaliseQuestion, photoUniqueId, messageLink, pointerReply }
  from "../lib/answeredAlready.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// ── the same photo, sent twice, is the same question ────────────────────────
const photoMsg = (uid: string, caption: string) => ({
  caption,
  photo: [
    { file_id: "small-abc", file_unique_id: uid },
    { file_id: "large-xyz", file_unique_id: uid },
  ],
});
const q36a = answerKey(photoMsg("AgADXYZ36", "@caparveensharmabot"), "");
const q36b = answerKey(photoMsg("AgADXYZ36", ""), "");
check("the same photo yields the same key however it is captioned", q36a === q36b, `${q36a} vs ${q36b}`);
check("a different photo is a different question",
  answerKey(photoMsg("AgADOTHER", ""), "") !== q36a);
check("the largest size's unique id is used",
  photoUniqueId(photoMsg("AgADXYZ36", "")) === "AgADXYZ36");
check("a message with no photo has no photo id", photoUniqueId({ text: "hello" }) === null);

// ── the two real re-asks ────────────────────────────────────────────────────
check("‘Ans to q 40’ and ‘Ans to q 40 @bot’ are one question",
  answerKey({}, "Ans to q 40 @caparveensharmabot") === answerKey({}, "ans to q40"),
  `${answerKey({}, "Ans to q 40 @caparveensharmabot")} vs ${answerKey({}, "ans to q40")}`);
check("the bot tag never changes the key",
  normaliseQuestion("solve question 18 @caparveensharmabot") === normaliseQuestion("Solve Question 18!"));

// ── a bare mention must NOT silence unrelated messages ─────────────────────
for (const bare of ["@caparveensharmabot", "ok", "?", "sir", "thanks", "yes sir"]) {
  check(`too short to be a question on its own: ${JSON.stringify(bare)}`,
    answerKey({}, bare) === null, `got ${answerKey({}, bare)}`);
}
check("a real question IS keyed",
  answerKey({}, "give best revision strategy for ca inter sep 26") !== null);

// ── two genuinely different questions must not collide ─────────────────────
check("different questions get different keys",
  answerKey({}, "explain AS 15 employee benefits in detail") !==
  answerKey({}, "explain AS 21 consolidated financial statements"));

// ── the pointer has to actually point somewhere ────────────────────────────
const link = messageLink("-1002882640508", 16125);
check("a supergroup id becomes a t.me permalink",
  link === "https://t.me/c/2882640508/16125", String(link));
check("a plain chat id yields no link rather than a wrong one",
  messageLink("12345", 7) === null);
const note = pointerReply("-1002882640508", { tgMessageId: 16125, at: "" });
check("the reply carries the link", note.includes("https://t.me/c/2882640508/16125"));
check("the reply invites a specific follow-up rather than closing the door",
  /WHICH STEP/.test(note));
check("the reply is short — the whole point is not to bury the room",
  note.length < 400, `${note.length} characters`);

// ── the webhook must consult it BEFORE spending an AI call ─────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
const hook = readFileSync(join(import.meta.dirname, "..", "app/api/telegram/webhook/route.ts"), "utf8");
check("the guard runs before the image is downloaded and the AI is called",
  hook.indexOf("alreadyAnswered(chatId, key)") < hook.indexOf("groupAiAnswer(subj.id, question"),
  "answering twice is wasteful as well as noisy");
check("the reply records what it answered",
  /answer_key: key,/.test(hook),
  "without this the next identical question finds nothing and is solved again");
check("a repeat returns instead of falling through to the answer",
  /pointerReply\(chatId, prior\)[\s\S]{0,120}return NextResponse/.test(hook));

console.log(fails === 0 ? "ok — one question, one answer" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
