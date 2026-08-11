import { isHoldable, ruleBroken, HOLDABLE, PENALTY_INR } from "../lib/supporterHold";

// WHEN A SELLER'S ACCOUNT MAY BE STOPPED AUTOMATICALLY — AND WHEN IT MAY NOT.
//
// This code accuses somebody of breaking an agreement and then takes ₹5,000
// off them, at three in the morning, with nobody watching. The whole safety of
// it rests on the answer to one question: what counts as a breach?

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── A SITE THAT IS DOWN IS NOT A SELLER WHO IS CHEATING ──────────────────
// This is the one that matters. Hosting fails, domains lapse, our own reader
// gets rate-limited — none of that is evidence of anything, and a penalty for
// it would be indefensible.
check(!isHoldable({ ok: false, problem: "unreachable", detail: "did not answer" }),
  "an unreachable site NEVER holds an account");
check(!HOLDABLE.includes("unreachable"), "…and is not even in the holdable list");

// ── A page that is fine holds nothing ────────────────────────────────────
check(!isHoldable({ ok: true }), "a clean page holds nothing");
check(!isHoldable({ ok: true, problem: undefined }), "no problem means no hold");

// ── The two rules that ARE visible on a public page ──────────────────────
check(isHoldable({ ok: false, problem: "discount", detail: "20% off" }), "over-discounting holds");
check(isHoldable({ ok: false, problem: "combo", detail: "bundled" }), "bundling with another faculty holds");
check(HOLDABLE.length === 2, `exactly two rules can be decided from a page (got ${HOLDABLE.length})`);

// A problem nobody has defined must not hold an account by default. New kinds
// of finding get added over time and each one must be opted IN to a penalty.
for (const unknown of ["", "slow", "typo", "price", "unknown", "offline"]) {
  check(!isHoldable({ ok: false, problem: unknown, detail: "x" } as never),
    `"${unknown}" is not a holdable finding — new findings must be opted in, never assumed`);
}

// ── The vendor is told which rule, in the agreement's own words ──────────
check(/5%/.test(ruleBroken("discount")), "the discount rule quotes the 5% figure");
check(/faculty/i.test(ruleBroken("combo")), "the bundling rule names what it forbids");
check(ruleBroken("discount") !== ruleBroken("combo"), "the two rules do not read the same");
check(ruleBroken(undefined).length > 0, "an unnamed problem still produces a sentence, never a blank");

// ── The penalty is fixed, in code ────────────────────────────────────────
check(PENALTY_INR === 5000, `the penalty is Rs.5,000 (got ${PENALTY_INR})`);
check(Number.isInteger(PENALTY_INR) && PENALTY_INR > 0, "it is a whole positive number of rupees");

console.log(fails === 0 ? "PASS  auto-hold: only discount and bundling, never an unreachable site, Rs.5,000 fixed" : "");
process.exit(fails === 0 ? 0 : 1);
