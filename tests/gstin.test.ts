// What a GST number can be checked for without asking anybody.
//
// His spec of 1 September wants GST mandatory and VERIFIED everywhere, with
// the trade name, address, city, state and PIN filled in from the GST records.
// The records need a paid lookup. The rest is arithmetic, and this is it.
//
// The anchor case is his own registration, 07AAYPS3155J1ZY — the Delhi GSTIN
// that already prints on every invoice the portal raises.
//
//   node --experimental-strip-types tests/gstin.test.ts

import { checkGstin, normaliseGstin, gstinCheckChar, gstinMatchesPan, GST_STATES }
  from "../lib/gstin.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// ── his own GSTIN ───────────────────────────────────────────────────────────
const HIS = "07AAYPS3155J1ZY";
const r = checkGstin(HIS);
check("his own GSTIN passes", r.ok, r.problem ?? "");
check("the state is read from it, with no lookup", r.state === "Delhi", String(r.state));
check("the state code comes back too", r.stateCode === "07");
check("the PAN falls out of it", r.pan === "AAYPS3155J", String(r.pan));
check("the check character is recomputed correctly",
  gstinCheckChar(HIS.slice(0, 14)) === "Y", gstinCheckChar(HIS.slice(0, 14)));
check("it matches the PAN we hold", gstinMatchesPan(HIS, "AAYPS3155J"));
check("it does not match somebody else's PAN", !gstinMatchesPan(HIS, "AAAPZ1234C"));

// ── typing it in, as a human does ───────────────────────────────────────────
check("lower case is accepted", checkGstin("07aayps3155j1zy").ok);
check("spaces are accepted", checkGstin("07 AAYPS3155J 1ZY").ok);
check("normalising strips punctuation", normaliseGstin(" 07-aayps3155j1zy ") === HIS);

// ── the mistakes it has to catch ────────────────────────────────────────────
const bad: [string, string, string][] = [
  ["", "empty", "Enter"],
  ["07AAYPS3155J1Z", "fourteen characters", "15 characters"],
  ["07AAYPS3155J1ZYY", "sixteen characters", "15 characters"],
  ["07AAYPS3155J1ZX", "one character mistyped", "check digit"],
  ["77AAYPS3155J1ZY", "not a real state code", "state code"],
  ["0AAYPS3155J11ZY", "wrong shape", "shape"],
  ["07AAYPS3155J1AY", "the fixed Z is wrong", "shape"],
];
for (const [value, what, expect] of bad) {
  const c = checkGstin(value);
  check(`refused: ${what}`, !c.ok, `${value} was accepted`);
  check(`  and says why: ${what}`,
    !!c.problem && c.problem.toLowerCase().includes(expect.toLowerCase()),
    c.problem ?? "no reason given");
}

// ── a wrong check digit must be caught for EVERY substitution ──────────────
// This is the whole value of the check character: one wrong keystroke anywhere
// in the first fourteen has to fail.
let caught = 0, tried = 0;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
for (let i = 0; i < 14; i++) {
  for (const ch of CHARS) {
    if (ch === HIS[i]) continue;
    const typo = HIS.slice(0, i) + ch + HIS.slice(i + 1);
    tried++;
    if (!checkGstin(typo).ok) caught++;
  }
}
check(`every single-character typo is caught (${caught}/${tried})`, caught === tried,
  `${tried - caught} slipped through`);

// ── the state table has to be complete enough to be trusted ────────────────
check("every state code is two digits", Object.keys(GST_STATES).every((k) => /^\d{2}$/.test(k)));
check("the codes that decide his own tax are right",
  GST_STATES["07"] === "Delhi" && GST_STATES["06"] === "Haryana" &&
  GST_STATES["27"] === "Maharashtra" && GST_STATES["29"] === "Karnataka");
check("there are enough of them to cover India", Object.keys(GST_STATES).length >= 37);

// ── the lookup is honest about not existing ────────────────────────────────
const { fetchGstParty } = await import("../lib/gstin.ts");
const f = await fetchGstParty(HIS);
check("fetching the trade name says plainly that no provider is configured",
  f.ok === false && /no gst lookup provider/i.test((f as { reason: string }).reason));

console.log(fails === 0 ? "ok — GSTIN" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
