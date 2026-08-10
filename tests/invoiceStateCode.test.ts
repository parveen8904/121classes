import { stateCode, computeGst } from "../lib/invoice";
import { INDIA_STATES, isIndianState, isIndianPincode } from "../lib/indiaStates";

// A GST INVOICE MUST CARRY THE STATE AND ITS CODE.
//
// On 10 August an invoice went to a student in Lucknow with "State Code:-" on
// it. His state field held "226029" — his PIN code — because the pay page asked
// for the state in a text box. Two separate faults, and this file guards both:
// every state we offer must resolve to a code, and a wrong value must not be
// accepted in the first place.
//
// This is not tidiness. The state code is a required field on a tax invoice,
// and the state is what decides CGST+SGST against IGST. An invoice without it
// is an incomplete tax document.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── Every state on the list has a code ────────────────────────────────────
for (const st of INDIA_STATES) {
  const code = stateCode(st);
  check(/^\d{2}$/.test(code), `"${st}" must resolve to a two-digit state code (got "${code}")`);
}
check(INDIA_STATES.length === 36, `all 36 states and union territories are offered (got ${INDIA_STATES.length})`);

// Codes must be unique — two states sharing one would misfile a return.
const codes = INDIA_STATES.map(stateCode);
check(new Set(codes).size === codes.length, "no two states share a code");

// The ones we actually sell to most, spelled as a student might.
for (const [given, want] of [
  ["Delhi", "07"], ["delhi", "07"], ["  DELHI  ", "07"],
  ["Uttar Pradesh", "09"], ["UTTAR PRADESH", "09"],
  ["West Bengal", "19"], ["Maharashtra", "27"], ["Karnataka", "29"], ["Uttarakhand", "05"],
] as const) {
  check(stateCode(given) === want, `"${given}" → ${want} (got "${stateCode(given)}")`);
}

// ── And the thing that caused it ──────────────────────────────────────────
check(!isIndianState("226029"), "a PIN code is not a state");
check(!isIndianState("+91"), "a dialling code is not a state");
check(!isIndianState(""), "blank is not a state");
check(!isIndianState("Lucknow"), "a city is not a state");
check(isIndianState("Uttar Pradesh"), "…but Uttar Pradesh is");
check(!isIndianPincode("+91"), "\"+91\" is not a PIN code");
check(!isIndianPincode("2260"), "four digits is not a PIN code");
check(isIndianPincode("226029"), "226029 is");

// ── The tax that follows from it ──────────────────────────────────────────
const s = { enabled: true, gstin: "07AAYPS3155J1ZY", legalName: "X", address: "", state: "Delhi",
  rate: 18, sac: "999293", inclusive: true, prefix: "" };

const up = computeGst(9897, "Uttar Pradesh", s as never);
check(up.igst > 0 && up.cgst === 0 && up.sgst === 0, "a Lucknow student is charged IGST, not CGST+SGST");
check(!up.intraState, "…and the invoice says inter-state");

const dl = computeGst(9897, "Delhi", s as never);
check(dl.cgst > 0 && dl.sgst > 0 && dl.igst === 0, "a Delhi student is charged CGST + SGST");
check(Math.abs(dl.cgst + dl.sgst - up.igst) < 0.02, "the total tax is the same either way — only the split differs");

// The halves must add back to the whole, to the paisa. 18% of 8387.29 is
// 1509.71, which does not halve evenly — one side has to carry the extra paisa.
check(Math.round((dl.taxable + dl.cgst + dl.sgst) * 100) === Math.round(dl.total * 100),
  "taxable + CGST + SGST equals the amount charged, to the paisa");
check(Math.round((up.taxable + up.igst) * 100) === Math.round(up.total * 100),
  "taxable + IGST equals the amount charged, to the paisa");
check(dl.total === 9897, "an inclusive price is not inflated by the tax working");

console.log(fails === 0 ? "PASS  invoice: all 36 states carry a code, tax splits by state, a PIN is never a state" : "");
process.exit(fails === 0 ? 0 : 1);
