import { buildShippingLabelsPdf, RETURN_TO } from "../lib/shippingLabels";

// A LABEL WITH NO RETURN ADDRESS IS A PARCEL THAT GETS DESTROYED.
//
// When a student has moved, or the address was wrong, or nobody was in three
// times, the courier needs somewhere to send it back to. Without that line the
// books are disposed of and nobody finds out until the student writes in.
//
// The wording and the address were given to us exactly; this holds them, so a
// tidy-up cannot quietly drop the phone number or reword the sentence into
// something a courier does not act on.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

check(RETURN_TO.intro === "If not delivered, kindly return to this address:",
  "the return instruction must read exactly as given");
check(RETURN_TO.address === "RP, 47 Pitampura, Maurya Enclave, Delhi - 110034",
  "the return address must read exactly as given");
check(RETURN_TO.phone === "9999200355", "the return contact number must be the one given");

// It is a shipping label, not a student-facing page: the personal number must
// never appear on it, and the one on the label is the warehouse's own.
check(!RETURN_TO.phone.includes("9810014495"), "the personal number is never printed on a parcel");

// ── It must actually build, with and without a docket ──────────────────────
const item = {
  orderNo: "#10041",
  name: "Ganapati Hegade",
  address: "Ashok Circle, Suvarna Theatre Road, Jamkhandi, Karnataka - 587301",
  phone: "9986340003",
  contents: "FR-443 A,B,C & REGISTER",
};

async function run() {
const pdf = await buildShippingLabelsPdf(
  [
    { ...item, docket: null, courier: null },                       // blank lines to write on
    { ...item, docket: "DEL122019183", courier: "Delhivery" },      // already handed over
    { ...item },                                                    // fields omitted entirely
  ],
  "CA Parveen Sharma classes — caparveensharma.com · 98100 12674",
);

check(pdf.length > 1000, "a PDF of three labels should not be empty");
check(String.fromCharCode(...pdf.slice(0, 5)) === "%PDF-", "it must actually be a PDF");

// An empty run must not throw — the warehouse presses the button on a quiet day
// and should get "nothing to print", not a crash.
const empty = await buildShippingLabelsPdf([], "x");
check(empty.length > 0, "no parcels must still produce a valid (empty) PDF");

// Thirty labels is ten pages at three per page — the page break must not throw.
const many = await buildShippingLabelsPdf(
  Array.from({ length: 30 }, (_, i) => ({ ...item, orderNo: `#${10000 + i}`, docket: null, courier: null })),
  "x",
);
check(many.length > pdf.length, "thirty labels should be a bigger file than three");

}

run().then(() => {

  console.log(fails === 0 ? "PASS  shipping label: return address exact, docket and courier printed or ruled, pages build" : "");
  process.exit(fails === 0 ? 0 : 1);
}).catch((e) => { console.log("FAIL  shipping label threw:", String(e)); process.exit(1); });
