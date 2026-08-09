// The words that must never be read as abuse.
//
// A student sent "Can you provide me the hit list" and was told his access
// would be withdrawn. "Hit list" is the most-requested thing on this channel —
// it is the list of must-do questions — but outside a CA classroom it reads as
// a list of people to harm, and nothing had ever told the classifier otherwise.
//
// The model call cannot be made here without spending money on every run, so
// what is checked is the thing that failed: the INSTRUCTIONS. If the vocabulary
// disappears from the prompt, or the second opinion is removed, this fails.
//
//   node --experimental-strip-types tests/moderationWords.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "..", "lib/ai.ts"), "utf8");

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// The judge's prompt must name the vocabulary that got a student warned.
const MUST_TEACH = ["hit list", "hitlist", "killer", "crack the exam"];
for (const word of MUST_TEACH) {
  check(`the classifier is taught "${word}"`, src.toLowerCase().includes(word),
    "not mentioned in lib/ai.ts, so the model has no reason to know it");
}

// One call must not be able to produce a warning on its own.
check("a flag is confirmed before it counts",
  /confirm/i.test(src) && src.includes("not confirmed on review"),
  "the second opinion appears to have been removed");

// Abuse must be aimed at a person — the rule that makes exam slang safe.
check("abuse must be aimed at a person",
  /AIMED AT A PERSON/.test(src),
  "the rule that separates insults from exam slang is missing");

// A private thread must not be told off as though it were the study group.
check("there is a private wording for direct messages",
  src.includes("ABUSE_WARNING_DIRECT"),
  "one-to-one messages would get the group warning, and its threat");

check("the private wording carries no threat of withdrawal",
  !/ABUSE_WARNING_DIRECT[\s\S]{0,400}withdrawn/.test(src),
  "a first private message should not threaten a student's access");

console.log(fails === 0 ? "PASS  moderation vocabulary and safeguards in place" : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
