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
// FREE_DAILY is a named constant, so it is resolved before the table is read —
// matching bare digits silently found nothing and reported "undefined".
const freeDaily = Number(/const FREE_DAILY = (\d+)/.exec(access)?.[1] ?? NaN);
const allowances = Object.fromEntries(
  [...(/const ALLOWANCE: Record<WaTier, number> = \{([\s\S]*?)\n\};/.exec(access)?.[1] ?? "")
    .matchAll(/(\w+):\s*([A-Z_]+|\d+)/g)]
    .map((m) => [m[1], m[2] === "FREE_DAILY" ? freeDaily : Number(m[2])]),
);

check("a paying student is not rationed", (allowances.paying ?? 0) >= 100,
  `paying allowance is ${allowances.paying}`);
// Five a day on the free plan — the founder's number.
check("the free plan is five questions a day",
  allowances.registered === 5 && allowances.stranger === 5,
  `registered ${allowances.registered}, stranger ${allowances.stranger}`);
check("a free user gets far less than a payer",
  allowances.registered < allowances.paying);

// The notice must SAY what the limit is, not just enforce it.
check("the notice states the daily limit",
  /five questions a day/i.test(access), "a limit nobody was told about reads as a fault");
check("the notice says plainly that it is a paid service",
  /paid service/i.test(access));

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

// THE LIMIT IS A SWITCH, AND IT IS OFF BY DEFAULT.
// Answering strangers for nothing is the marketing; the founder wants it
// running while the launch is fresh, and a way to close it later.
check("the limit is off unless switched on",
  /String\(data\?\.value \?\? ""\) === "1"/.test(access),
  "the default must be OFF");
check("a failure to read the switch keeps answering",
  /catch \{[\s\S]{0,300}return false;/.test(access),
  "if we cannot tell, we must not turn students away");
check("a paying student is never gated even when it is on",
  /tier === "paying" \|\| answeredToday < allowance/.test(access));

// Strangers are remembered, and invited once.
check("an unregistered number is saved as a lead",
  /from\("leads"\)[\s\S]{0,200}insert/.test(access));
check("a lead is never duplicated",
  /eq\("phone", digits\)[\s\S]{0,120}if \(known\?\.id\) return;/.test(access));
check("the invitation names both app stores",
  /play\.google\.com/.test(access) && /apps\.apple\.com/.test(access));
check("the invitation goes only on a first answer",
  /wasNew \? JOIN_INVITE : ""/.test(answer),
  "repeating it under every reply turns help into advertising");

// Nobody is refused in silence.
check("a gated message still says something useful",
  /caparveensharma\.com\/pricing/.test(access) && /notes/.test(access),
  "a refusal must still name what is free and where to buy");

console.log(fails === 0
  ? `PASS  paying ${allowances.paying}, registered ${allowances.registered}, stranger ${allowances.stranger} — distress never gated`
  : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
