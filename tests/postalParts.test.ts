import { parsePostalParts } from "../lib/indiaStates";

let fails = 0;
const check = (addr: string, want: { city: string; state: string; pincode: string }) => {
  const got = parsePostalParts(addr);
  for (const k of ["city", "state", "pincode"] as const) {
    if (got[k] !== want[k]) {
      console.error(`FAIL ${JSON.stringify(addr)}\n  ${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(want[k])}`);
      fails++;
    }
  }
};

// ── the real addresses in gift_orders today ──────────────────────────────
// State glued to the PIN. Whole-part matching missed this; it is the single
// most common shape on the system.
check("B173 Nirman Vihar, Delhi 110092", { city: "Delhi", state: "Delhi", pincode: "110092" });

// No state, no PIN — nothing recoverable, so every column stays empty rather
// than being filled with a street name.
check("Mig 68 b block panki kanpur\nDr VSEC panki", { city: "", state: "", pincode: "" });

// ── the shape on the warehouse screen ────────────────────────────────────
// City and state in one part, no comma between them.
check("A/801 Saifee Park, Bldg no 1, Mumbai Maharashtra 400010",
      { city: "Mumbai", state: "Maharashtra", pincode: "400010" });

// ── the tidy form, still has to work ─────────────────────────────────────
check("12 MG Road, Bengaluru, Karnataka, 560001",
      { city: "Bengaluru", state: "Karnataka", pincode: "560001" });

// ── a street line must never land in the City column ─────────────────────
check("221B Baker Street, Uttar Pradesh 226001",
      { city: "", state: "Uttar Pradesh", pincode: "226001" });

// ── word boundaries: a place that merely CONTAINS a state name ───────────
check("Goalpara Road, Assam 783101", { city: "", state: "Assam", pincode: "783101" });

// ── rubbish in, blanks out ───────────────────────────────────────────────
check("", { city: "", state: "", pincode: "" });
check("please call me", { city: "", state: "", pincode: "" });
// 000000 is what people type to get past a form; it is not a PIN. The word
// before the state IS the city position, though, so that column is filled —
// my first version of this test expected a blank and was simply wrong.
check("Somewhere, Kerala 000000", { city: "Somewhere", state: "Kerala", pincode: "" });

console.log(fails === 0
  ? "PASS  postal parts: glued states found, street lines refused, blanks left blank"
  : `FAIL  ${fails} case(s)`);
process.exit(fails === 0 ? 0 : 1);
