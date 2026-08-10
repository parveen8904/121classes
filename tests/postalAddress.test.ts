import { INDIA_STATES, isIndianState, isIndianPincode, formatPostalAddress, looksPostableInIndia } from "../lib/indiaStates";

// WE CANNOT POST A PARCEL ABROAD.
//
// There is no international courier on this account. An order taken for an
// address outside India is an order that cannot be fulfilled, and the student
// learns that weeks later, having paid. So the seller picks a state from a list
// rather than typing one, and the server checks the same thing again, because
// the form is only the browser's copy of the rules.
//
// The other half of this is the courier label. It used to be one free-text box
// headed "full postal address with PIN code", which a seller in a hurry fills
// in without the state — the one field the courier actually sorts on.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── Every state and union territory, so nobody has to pick "Other" ─────────
check(INDIA_STATES.length === 36, `expected 36 states and union territories, found ${INDIA_STATES.length}`);
for (const s of ["Delhi", "Kerala", "Ladakh", "Sikkim", "Puducherry", "Lakshadweep", "Andaman and Nicobar Islands"]) {
  check(isIndianState(s), `${s} should be on the list`);
}
check(isIndianState("delhi"), "matching is not case-sensitive — a stored value may differ in case");
check(isIndianState("  Karnataka  "), "surrounding spaces should not fail a real state");

// ── And nowhere we cannot post to ─────────────────────────────────────────
for (const s of ["California", "Dubai", "Sindh", "Other", "", "   ", "India"]) {
  check(!isIndianState(s), `"${s}" is not somewhere we can post a parcel`);
}
check(!isIndianState(null), "a missing state is not a state");
check(!isIndianState(undefined), "an absent state is not a state");

// ── PIN codes ─────────────────────────────────────────────────────────────
for (const p of ["110001", "560034", "700001"]) check(isIndianPincode(p), `${p} is a real PIN code`);
for (const p of ["000000", "0", "12345", "1234567", "11000a", "", "ABCDEF", "  "]) {
  check(!isIndianPincode(p), `"${p}" should not pass as a PIN code`);
}
check(!isIndianPincode("012345"), "an Indian PIN never starts with zero");
check(isIndianPincode(" 110001 "), "spaces around a real PIN should not fail it");

// ── The label a courier reads ─────────────────────────────────────────────
const label = formatPostalAddress({
  line1: "12 Nehru Place", line2: "Near the metro", city: "New Delhi", state: "Delhi", pincode: "110019",
});
check(label.split("\n").length === 4, "a label is lines, not a paragraph");
check(label.includes("New Delhi, Delhi - 110019"), "city, state and PIN belong on one line together");
check(label.endsWith("India"), "the country is stated, because a courier does not assume it");

// A half-filled address must not produce a label with holes in it — no stray
// commas or dashes for a parcel clerk to puzzle over.
const sparse = formatPostalAddress({ line1: "12 Nehru Place", city: "New Delhi" });
check(!sparse.includes(" - "), "no dangling dash when there is no PIN");
check(!/,\s*\n/.test(sparse), "no dangling comma when there is no state");
check(sparse.startsWith("12 Nehru Place"), "what was given is still there");

const empty = formatPostalAddress({});
check(empty === "India", "an empty address is just the country, not a pile of punctuation");

// ── The server's own check, on the finished text ──────────────────────────
// The form only offers Indian states, but a form is the browser's copy of the
// rules. An order posted straight at the server must be refused the same way.
check(looksPostableInIndia(label), "our own composed label must be accepted");
check(looksPostableInIndia("12 MG Road, Bengaluru, Karnataka - 560001, India"), "a one-line address is fine too");
check(looksPostableInIndia("Flat 4\nMumbai\nMaharashtra\n400001"), "line breaks with no punctuation are fine");

check(!looksPostableInIndia("1600 Amphitheatre Pkwy, Mountain View, California 94043, USA"), "an American address cannot be posted");
check(!looksPostableInIndia("PO Box 1234, Dubai, UAE"), "nor a Dubai one");
check(!looksPostableInIndia("12 MG Road, Bengaluru, Karnataka"), "a real state with no PIN cannot be sorted");
check(!looksPostableInIndia("12 MG Road, Bengaluru - 560001"), "a real PIN with no state is not enough either");
check(!looksPostableInIndia(""), "an empty address is refused");
check(!looksPostableInIndia(null), "so is a missing one");

console.log(fails === 0 ? `PASS  postal address: ${INDIA_STATES.length} states, PIN codes, and a label a courier can read` : "");
process.exit(fails === 0 ? 0 : 1);
