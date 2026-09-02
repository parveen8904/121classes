// Billing and shipping, asked once and remembered.
//
// His instruction, 2 September 2026: "whenever any student is ordering or any
// vendor or supporter is ordering any product, you have to ask the billing
// address as well as the shipping address and you will post these addresses to
// the profile. If there is any mismatch with the profile address, you can just
// tell them that profile has a different address… The billing address will be
// of the vendor and the shipping address will be of the student." And on the
// fields: "pin code and selection of the state and everything in separate rows
// like a professional address book… landmark also as an option… choice of
// telling whether the billing address and shipping address is same so that he
// has not to fill the address again… and GST number."
//
//   node --experimental-strip-types tests/checkoutAddress.test.ts

import {
  toAddress, addressProblems, sameAddress, addressDifferences,
  formatAddress, addressLines, isBlank, EMPTY_ADDRESS,
} from "../lib/address.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const good = toAddress({
  name: "Parveen Sharma", line1: "B-173, Nirman Vihar", line2: "", landmark: "Metro pillar 47",
  city: "Delhi", state: "Delhi", pincode: "110092", phone: "9810012674",
});

// ── the fields themselves ──────────────────────────────────────────────────
check("a complete address has nothing missing", addressProblems(good).length === 0,
  addressProblems(good).join(", "));
check("an empty address is empty", isBlank(EMPTY_ADDRESS) && !isBlank(good));
check("country defaults to India rather than to nothing",
  toAddress({}).country === "India");

// A pincode is six digits — typed with a space, pasted with a hyphen, it is
// still six digits, and anything else is not an address a courier can use.
check("a pincode keeps only its digits", toAddress({ pincode: "110 092" }).pincode === "110092");
check("a pincode is capped at six", toAddress({ pincode: "1100921234" }).pincode === "110092");
for (const bad of ["11009", "1100", "", "ABCDEF"]) {
  check(`"${bad}" is refused as a pincode`,
    addressProblems({ ...good, pincode: bad }).some((m) => m.includes("pincode")));
}

// The state is chosen, never typed: a courier reads a state, and on a tax
// invoice the state decides CGST+SGST against IGST.
check("a state not on the list is refused",
  addressProblems({ ...good, state: "delhi ncr" }).some((m) => m.includes("state")),
  "‘Delhi’, ‘New Delhi’ and ‘delhi ncr’ cannot all be allowed to mean the same place");
check("a missing state is named, not glossed over",
  addressProblems({ ...good, state: "" }).includes("state"));

// The landmark is optional and must never block an order.
check("no landmark is not a problem", addressProblems({ ...good, landmark: "" }).length === 0);
check("but it is carried through when given", toAddress(good).landmark === "Metro pillar 47");
check("and it reaches the courier label, in words a courier reads",
  addressLines(good).some((l) => l === "Near Metro pillar 47"),
  addressLines(good).join(" | "));

// Each missing thing is NAMED — "please fill in all the required details"
// leaves the buyer hunting for the empty box.
{
  const bare = addressProblems(toAddress({}));
  check("an empty form names every missing field",
    bare.includes("name") && bare.includes("address line 1") && bare.includes("city") &&
    bare.includes("state") && bare.some((m) => m.includes("pincode")),
    bare.join(", "));
}
check("a phone is required for delivery but not for billing",
  addressProblems({ ...good, phone: "" }).some((m) => m.includes("phone")) &&
  addressProblems({ ...good, phone: "" }, { needPhone: false }).length === 0);
check("we do not take an order we cannot post",
  addressProblems({ ...good, country: "United States" }).some((m) => m.includes("India")));

// ── same as shipping, and the mismatch notice ──────────────────────────────
check("the same place written differently is the same place",
  sameAddress(good, toAddress({ ...good, line1: "b-173,  nirman vihar" })),
  "punctuation and case are not a change of address");
check("a different pincode is a different place",
  !sameAddress(good, { ...good, pincode: "110091" }));
check("the phone is not part of whether it is the same address",
  sameAddress(good, { ...good, phone: "9999999999" }));
check("the landmark is not either — it is a hint, not the address",
  sameAddress(good, { ...good, landmark: "" }));

// His rule: TELL them, do not overwrite and do not refuse.
{
  const moved = { ...good, line1: "C-12, Preet Vihar", pincode: "110091" };
  const diff = addressDifferences(moved, good);
  check("a difference from the profile is named field by field",
    diff.includes("address line 1") && diff.includes("pincode") && diff.length === 2,
    diff.join(", "));
}
check("nothing is 'different' when the profile holds no address yet",
  addressDifferences(good, EMPTY_ADDRESS).length === 0,
  "a first-time buyer must not be told their profile disagrees with them");

// ── formatting ────────────────────────────────────────────────────────────
check("one line reads as an address",
  formatAddress(good) === "B-173, Nirman Vihar, near Metro pillar 47, Delhi, Delhi, 110092",
  formatAddress(good));
check("empty parts leave no double commas",
  !/,\s*,/.test(formatAddress(toAddress({ line1: "A-1", city: "Delhi", state: "Delhi", pincode: "110092" }))));

// ── the checkout actually does it ─────────────────────────────────────────
const cart = readFileSync(join(import.meta.dirname, "..", "app/books/cartActions.ts"), "utf8");
const book = readFileSync(join(import.meta.dirname, "..", "app/books/[id]/payActions.ts"), "utf8");
for (const [name, src] of [["cart", cart], ["single book", book]] as [string, string][]) {
  check(`${name}: "same as shipping" is honoured on the SERVER`,
    /d\?\.sameAsShipping \? \{ \.\.\.shipping \} : toAddress\(d\?\.billing\)/.test(src),
    "a form can send anything; the copy must be made where it cannot be tampered with");
  check(`${name}: the billing address is not validated when it is a copy`,
    /d\?\.sameAsShipping \? \[\] : addressProblems\(billing/.test(src),
    "asking for it twice is exactly what the tick box exists to avoid");
  check(`${name}: a wrong GST number stops the order`,
    /if \(gst && !gst\.ok\) missing\.push/.test(src),
    "the check digit is arithmetic — catch it before the invoice, not after");
  check(`${name}: an absent GST number does not`,
    /const gst = gstinRaw \? checkGstin\(gstinRaw\) : null/.test(src),
    "most buyers have none and must not be made to feel they failed the form");
  check(`${name}: both addresses are frozen onto the order`,
    /ship_to: ship,[\s\S]{0,220}bill_to: bill/.test(src),
    "the profile may be edited tomorrow; an invoice must keep saying what it said");
  check(`${name}: the addresses go back to the profile`,
    /patch: Record<string, unknown> = \{ shipping_address: ship \}/.test(src));
  check(`${name}: the billing address goes to the columns the INVOICE reads`,
    /patch\.address_line1 = bill\.line1/.test(src) && /patch\.state = bill\.state/.test(src),
    "the state is what decides CGST+SGST against IGST — a second jsonb copy would drift");
  check(`${name}: a blank billing address never wipes a good one on file`,
    /if \(bill\.line1 && bill\.city\) \{/.test(src));
  check(`${name}: a guest has no profile to write to`,
    /if \(n\.userId\) \{/.test(src));
}

// ── the form the buyer meets ──────────────────────────────────────────────
const fields = readFileSync(join(import.meta.dirname, "..", "app/components/AddressFields.tsx"), "utf8");
check("the state is a list, not a free-text box", /<select id=\{`\$\{idPrefix\}-state`\}/.test(fields));
check("the pincode box takes six digits and nothing else",
  /maxLength=\{6\}/.test(fields) && /replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/.test(fields));
check("the landmark is offered and marked optional", /Landmark <span className="muted"/.test(fields));
check("a billing address is not asked for a landmark", /showLandmark = true/.test(fields));
check("the browser can autofill it", /autoComplete="postal-code"/.test(fields) && /autoComplete="address-line1"/.test(fields));

for (const page of ["app/books/cart/CartCheckout.tsx", "app/books/[id]/BookCheckout.tsx"]) {
  const src = readFileSync(join(import.meta.dirname, "..", page), "utf8");
  const who = page.includes("cart") ? "cart" : "single book";
  check(`${who}: the tick box exists so the address is not typed twice`,
    /checked=\{sameAsShipping\}/.test(src));
  check(`${who}: the billing form only appears when it is actually different`,
    /\{!sameAsShipping && \(/.test(src));
  check(`${who}: it is prefilled from the profile`, /myAddressBook\(\)\.then/.test(src));
  check(`${who}: a profile difference is pointed out, not overwritten in silence`,
    /Your profile has a different address on file/.test(src));
  check(`${who}: the GST field is there, prefilled when the profile has one`,
    /<GstinField value=\{gstin\}[\s\S]{0,120}fromProfile=/.test(src));
  check(`${who}: the missing fields are named back to the buyer`,
    /setProblems\(res\.missing/.test(src),
    "‘please fill in all the required details’ leaves them hunting");
  check(`${who}: the sponsor case is explained where it is used`,
    /sponsored order/.test(src));
}

console.log(fails === 0 ? "ok — checkout addresses" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
