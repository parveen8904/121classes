// A STUDENT IN TROUBLE MUST NOT BE SORTED AS CHATTER.
//
// This is the one classifier where the two mistakes do not cost the same. An
// unnecessary offer of help is a small awkwardness. A missed one is not
// something that can be put right afterwards.
//
// A match is confirmed with the model where one is reachable, because these
// words also live in the syllabus — "the suicide clause in a life insurance
// policy" is a textbook question, and an urgent alarm every time somebody
// studies Ind AS 104 teaches everyone to stop reading the alarms.
//
// But when the model CANNOT be reached — no key, a timeout, an account over
// its limit — the two cases part company: an explicit statement about ending a
// life still gets the helplines, and a soft signal does not. That asymmetry is
// the safety property, and it is what these checks hold in place.
//
// The word lists are the safety-critical part, so they are what is tested.
//
//   node --experimental-strip-types tests/distress.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "..", "lib/distress.ts"), "utf8");

const grab = (name: string): RegExp => {
  const m = new RegExp(`const ${name} =\\s*\\n?\\s*(/.*/[a-z]*);`, "s").exec(src);
  if (!m) throw new Error(`could not find ${name} in lib/distress.ts`);
  // eslint-disable-next-line no-eval
  return eval(m[1]) as RegExp;
};

const SEVERE = grab("SEVERE");
const SOFT = grab("SOFT");

let fails = 0;
const check = (name: string, got: unknown, want: unknown) => {
  if (got === want) return;
  fails++;
  console.error(`FAIL  ${name} — got ${got}, want ${want}`);
};

// ── Must ALWAYS be caught, with no model involved ───────────────────────────
const MUST_CATCH = [
  "i want to die",
  "I don't want to live anymore",
  "sir I am thinking of ending my life",
  "I feel suicidal",
  "i want to kill myself",
  "sometimes I want to hurt myself",
  "mujhe marna chahta hun ab",
  "jeene ka mann nahi karta",
  "sir main jaan de dunga",
  "there is no reason to live",
  "everyone would be better off dead",
];
for (const t of MUST_CATCH) check(`severe: "${t}"`, SEVERE.test(t), true);

// ── Exam talk. A helpline under every one of these would train everybody to
//    ignore the ones that matter. ────────────────────────────────────────────
const MUST_NOT_ALARM = [
  "this paper killed me",
  "I'm dying, the exam was so long",
  "mar gaya aaj ka paper dekh kar",
  "AS 13 is killing me",
  "kill this chapter today",
  "that question murdered my confidence",
];
for (const t of MUST_NOT_ALARM) check(`not severe: "${t}"`, SEVERE.test(t), false);

// ── Softer signals: flagged for a second look, never acted on alone ─────────
const MUST_ASK = [
  "I feel so hopeless about this attempt",
  "I am depressed sir",
  "I can't cope anymore",
  "I failed again and I feel worthless",
  "I cry every day before the exam",
  "himmat nahi ho rahi",
];
for (const t of MUST_ASK) check(`soft: "${t}"`, SOFT.test(t), true);

// A plain study question must trip neither list — otherwise every doubt pays
// for a model call it does not need.
const PLAIN = [
  "how do I value a current investment under AS 13",
  "can you provide me the hit list",
  "what is the treatment of buy back",
];
for (const t of PLAIN) {
  check(`plain, not severe: "${t}"`, SEVERE.test(t), false);
  check(`plain, not soft: "${t}"`, SOFT.test(t), false);
}

// ── The reply itself ────────────────────────────────────────────────────────
const HELPLINES = ["14416", "1800-599-0019", "9999 666 555", "9820 466 726", "112"];
for (const n of HELPLINES) {
  check(`the reply still carries ${n}`, src.includes(n), true);
}
check("the reply does not diagnose", /you (have|are suffering from)/i.test(src), false);
// The safety property that matters most: when the model cannot be reached, a
// severe match must STILL count. Both fallback branches must say so — one for
// a missing key, one for a call that threw.
check("no model available → a severe match still counts",
  /if \(!apiKey\) \{[\s\S]{0,220}severe\s*\n?\s*\?\s*\{ distressed: true, severe: true/.test(src), true);
check("the check failing → a severe match still counts",
  /catch \{[\s\S]{0,260}severe\s*\n?\s*\?\s*\{ distressed: true, severe: true/.test(src), true);
check("a soft signal alone never fires without confirmation",
  /soft signal, no model to check with/.test(src), true);

// Words from the syllabus must be able to clear themselves, or every Ind AS 104
// question becomes an urgent alarm and the alarms stop being read.
check("textbook mentions are excluded in the judgement",
  /ACADEMICALLY rather than about themselves/.test(
    readFileSync(join(import.meta.dirname, "..", "lib/ai.ts"), "utf8")), true);

console.log(fails === 0
  ? `PASS  ${MUST_CATCH.length} severe caught, ${MUST_NOT_ALARM.length} exam phrases ignored, helplines intact`
  : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
