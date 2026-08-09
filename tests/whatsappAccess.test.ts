// WHO GETS HOW MUCH ON A NUMBER ANYONE CAN FIND.
//
// The business number is printed on the website. Twenty-five numbers had
// written in; thirteen had an account and exactly ONE was paying. The rest were
// getting unlimited tutoring built on material this business sells.
//
// The tiers and their allowances are the whole of the rule, so they are what is
// tested — along with the two things that must never break: a distressed person
// is never gated, and the gate notice must not count as an answer.
//
//   node --experimental-strip-types tests/whatsappAccess.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const access = readFileSync(join(root, "lib/whatsappAccess.ts"), "utf8");
const answer = readFileSync(join(root, "lib/whatsappAnswer.ts"), "utf8");

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// The allowances, lifted from the source so the test cannot drift from it.
const allowances = Object.fromEntries(
  [...(/const ALLOWANCE: Record<WaTier, number> = \{([\s\S]*?)\}/.exec(access)?.[1] ?? "")
    .matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
);

check("a paying student is not rationed", (allowances.paying ?? 0) >= 100,
  `paying allowance is ${allowances.paying}`);
check("a registered student gets a few a day",
  allowances.registered > 0 && allowances.registered <= 10,
  `registered allowance is ${allowances.registered}`);
check("a stranger gets at least one",
  allowances.stranger >= 1, "nobody should be met with silence on their first message");
check("a stranger gets less than a registered student",
  allowances.stranger < allowances.registered);
check("a registered student gets less than a payer",
  allowances.registered < allowances.paying);

// ── The two things that must never break ────────────────────────────────────

// Distress runs first and does not consult the gate. Somebody in trouble is not
// a billing question.
const distressAt = answer.indexOf("checkDistress");
const gateAt = answer.indexOf("whatsappAccess");
check("distress is checked before the gate", distressAt !== -1 && gateAt !== -1 && distressAt < gateAt,
  "a person in trouble must never be turned away for not having paid");

// The gate notice carries a marker, and the counter ignores anything carrying
// it — otherwise telling somebody their allowance is used up would itself use
// up tomorrow's.
check("the gate notice is marked", /\[\[gate\]\]/.test(access));
check("marked messages are not counted as answers",
  /!body\.includes\("\[\[gate\]\]"\)/.test(access),
  "the notice would consume the next day's allowance");

// Gating happens before the model is called — there is no sense paying for an
// answer nobody will receive.
const aiAt = answer.indexOf("aiConfigured()");
check("the gate is checked before the model is paid for",
  gateAt !== -1 && aiAt !== -1 && gateAt < aiAt);

// Nobody is refused in silence.
check("a gated message still says something useful",
  /caparveensharma\.com\/pricing/.test(access) && /notes/.test(access),
  "a refusal must still name what is free and where to buy");

console.log(fails === 0
  ? `PASS  paying ${allowances.paying}, registered ${allowances.registered}, stranger ${allowances.stranger} — distress never gated`
  : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
