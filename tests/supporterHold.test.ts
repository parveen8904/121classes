import { isHoldable, ruleBroken, HOLDABLE, PENALTY_INR, penaltySplit } from "../lib/supporterHold";

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

// ── THE PENALTY IS INCLUSIVE OF GST ─────────────────────────────────────
// ₹5,000 is what leaves the vendor's account. Charging ₹5,000 + 18% would take
// ₹5,900 from somebody who was shown ₹5,000, and booking the whole ₹5,000 as
// income would overstate it and understate the tax.
const sp = penaltySplit();
check(sp.total === 5000, "the vendor pays exactly Rs.5,000");
check(Math.abs(sp.taxable - 4237.29) < 0.01, `taxable is Rs.4,237.29 (got ${sp.taxable})`);
check(Math.abs(sp.tax - 762.71) < 0.01, `GST inside it is Rs.762.71 (got ${sp.tax})`);
check(Math.round((sp.taxable + sp.tax) * 100) === Math.round(sp.total * 100),
  "taxable + tax adds back to the amount charged, to the paisa");
check(sp.taxable < sp.total, "the taxable value is LESS than the total — tax is inside, not added");

console.log(fails === 0 ? "PASS  auto-hold: only discount and bundling, never an unreachable site, Rs.5,000 inclusive of GST" : "");
process.exit(fails === 0 ? 0 : 1);
