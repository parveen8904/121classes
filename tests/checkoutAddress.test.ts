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

// ── billing first, shipping derived — Ravi's spec of 2 September ──────────
//
//   "Add Same as Billing Address and Ship to a Different Address options.
//    Neither option should be selected by default... No option selected →
//    Billing Address should be considered as Shipping Address."
//
// So the choice has THREE states and the third is not an error. This replaces
// the earlier "billing same as shipping" tick box, which had to pick a side.
//
// WHERE THE ORDER IS WRITTEN MOVED, AND THIS FILE DID NOT FOLLOW IT.
//
// On 3 September 2026 a payment landed with no order behind it, because the
// row was only ever written in the browser's callback — so a closed tab lost
// the sale. Finishing it moved into lib/bookOrderFinish.ts, shared by both
// checkouts and by the recovery sweep, and every assertion below about
// freezing the addresses onto the order went on reading cartActions.ts, found
// nothing, and reported twelve failures against working code.
//
// A test that scrapes source has to be told when the source moves. Both halves
// are read together now: the checkout that validates, and the finisher that
// writes.
const finish = readFileSync(join(import.meta.dirname, "..", "lib/bookOrderFinish.ts"), "utf8");
const cart = readFileSync(join(import.meta.dirname, "..", "app/books/cartActions.ts"), "utf8") + finish;
const book = readFileSync(join(import.meta.dirname, "..", "app/books/[id]/payActions.ts"), "utf8") + finish;
for (const [name, src] of [["cart", cart], ["single book", book]] as [string, string][]) {
  check(`${name}: shipping is derived from billing on the SERVER`,
    /d\?\.shipTo === "different" \? toAddress\(d\?\.shipping\) : \{ \.\.\.billing \}/.test(src),
    "a form can send anything; the copy must be made where it cannot be tampered with");
  check(`${name}: choosing neither option is a documented answer, not a refusal`,
    !/shipTo === "unset"[\s\S]{0,80}missing\.push/.test(src),
    "the spec says an unset choice means ship to the billing address");
  check(`${name}: a billing address may be outside India`,
    /addressProblems\(billing, \{ needPhone: false, indiaOnly: false \}\)/.test(src),
    "we cannot post abroad, but we can invoice abroad");
  check(`${name}: the delivery address must still be one we can post to`,
    /addressProblems\(shipping\)/.test(src));
  check(`${name}: a wrong GST number stops the order`,
    /if \(gst && !gst\.ok\) missing\.push/.test(src),
    "the check digit is arithmetic — catch it before the invoice, not after");
  check(`${name}: an absent GST number does not`,
    /const gst = gstinRaw \? checkGstin\(gstinRaw\) : null/.test(src),
    "most buyers have none and must not be made to feel they failed the form");
  check(`${name}: both addresses are frozen onto the order`,
    /ship_to: ship,[\s\S]{0,260}bill_to: bill/.test(src),
    "the profile may be edited tomorrow; an invoice must keep saying what it said");
  check(`${name}: the addresses go back to the profile`,
    /patch: Record<string, unknown> = \{ shipping_address: ship \}/.test(src));
  check(`${name}: the billing address goes to the columns the INVOICE reads`,
    /patch\.address_line1 = bill\.line1/.test(src) && /patch\.state = bill\.state/.test(src),
    "the state is what decides CGST+SGST against IGST — a second jsonb copy would drift");
  check(`${name}: a blank billing address never wipes a good one on file`,
    /if \(bill\.line1 && bill\.city\) \{/.test(src));
  check(`${name}: a guest has no profile to write to`, /if \(n\.userId\) \{/.test(src));
  check(`${name}: the GST-registered name is carried and saved`,
    /trade: String\(d\?\.tradeName/.test(src) && /patch\.trade_name = tradeName/.test(src));
}

// ── the form the buyer meets ──────────────────────────────────────────────
const fields = readFileSync(join(import.meta.dirname, "..", "app/components/AddressFields.tsx"), "utf8");
check("an Indian state is a list, never a free-text box",
  /<select id=\{`\$\{idPrefix\}-state`\}/.test(fields),
  "one student's invoice read ‘State Code:-’ because this was free text");
check("the Indian PIN box takes six digits and nothing else",
  /replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/.test(fields));
check("a postcode from elsewhere may carry letters",
  /\.toUpperCase\(\)\.replace\(\/\[\^0-9A-Z -\]\/g, ""\)/.test(fields),
  "SW1A 1AA is a postcode; stripping it to digits destroys it");
check("country offers India or elsewhere where that is allowed",
  /<option value="Other">Other country<\/option>/.test(fields));
check("but a parcel is still India-only, and says so",
  /Parcels go by courier inside India only/.test(fields));
check("the landmark is offered and marked optional", /Landmark <span className="muted"/.test(fields));
check("a billing address is not asked for a landmark", /showLandmark = true/.test(fields));
check("the browser can autofill it", /autoComplete="postal-code"/.test(fields) && /autoComplete="address-line1"/.test(fields));

// ── nobody reaches a payment gateway unreviewed ───────────────────────────
// Ravi marks this Critical: "No payment should be initiated until the user
// confirms the Billing and Shipping details on every enrollment... even if the
// student has enrolled previously and their address details are already saved."
const step = readFileSync(join(import.meta.dirname, "..", "app/components/CheckoutAddressStep.tsx"), "utf8");
check("there is a review screen showing both addresses back",
  /Please check these before you pay/.test(step));
check("each address on it can be edited from there", /onEdit=\{\(\) => setStep\("edit"\)\}/.test(step));
check("confirming is what produces the details to pay with",
  /onClick=\{\(\) => onConfirmedChange\(\{ email/.test(step));
check("ANY edit undoes the confirmation",
  /setStep\("edit"\);\s*\n\s*onConfirmedChange\(null\);/.test(step),
  "otherwise someone confirms, changes the PIN code, and pays against what they were shown");
check("neither shipping option is selected by default",
  /useState<ShipChoice>\("unset"\)/.test(step));
check("and leaving it alone is explained, not scolded",
  /we will send it to the billing address above/.test(step));
check("the GST number is verified on demand, and can fill the address in",
  /const r = await verifyGstin\(gstin\)/.test(step) && /filled in from the GST records/.test(step));
check("the registered name is taken exactly as it arrives",
  /setTradeName\(r\.party\.tradeName \?\? r\.party\.legalName \?\? ""\)/.test(step),
  "‘M/s. RAVI ENTERPRISES’ and ‘M/s Ravi Enterprises’ are not the same legal name");

for (const page of ["app/books/cart/CartCheckout.tsx", "app/books/[id]/BookCheckout.tsx"]) {
  const src = readFileSync(join(import.meta.dirname, "..", page), "utf8");
  const who = page.includes("cart") ? "cart" : "single book";
  check(`${who}: the address step is the shared one`, /<CheckoutAddressStep onConfirmedChange=\{setConfirmed\}/.test(src));
  check(`${who}: the pay button is dead until the details are confirmed`,
    /disabled=\{busy[^}]*!confirmed\}/.test(src), "Critical, in his own words");
  check(`${who}: and it says why it is dead`, /Confirm your details above to pay/.test(src));
  check(`${who}: the order is placed with the CONFIRMED details, not live form state`,
    /if \(!confirmed\) return;/.test(src));
}

// ── what only the GST register knows ──────────────────────────────────────
const gst = readFileSync(join(import.meta.dirname, "..", "lib/gstin.ts"), "utf8");
check("a name from the register is never tidied",
  /const asIs = /.test(gst) && !/tradeName[^\n]*\.trim\(\)/.test(gst),
  "capitalisation, spacing and spelling are part of a legal identifier");
check("‘could not look it up’ is not reported as ‘the number is wrong’",
  /configured: false/.test(gst),
  "conflating them makes a correct number look forged");
check("the state falls back to the one the NUMBER encodes",
  /state: asIs\(addr\.stcd \?\? d\.state\) \?\? check\.state/.test(gst));
check("the lookup cannot hang a checkout", /AbortSignal\.timeout/.test(gst));
check("the provider is configured as a secret, not hard-coded",
  /getSecret\("GST_LOOKUP_URL"\)/.test(cart) && /getSecret\("GST_LOOKUP_KEY"\)/.test(cart));
check("and gstin.ts itself imports nothing, so a test can load it",
  !/^import /m.test(gst),
  "a module that reaches for secrets is a module no test can run — this is how 28 test files died");

// ── the profile pages, both of them ───────────────────────────────────────
// "State is currently a manual text field → change State field to a dropdown."
// "Country selection is currently not available → add Country field with
//  India / Other Country options." — Ravi, 2 September 2026, both Medium.
const block = readFileSync(join(import.meta.dirname, "..", "app/components/ProfileAddressBlock.tsx"), "utf8");
check("a profile's Indian state is a dropdown", /<select id=\{`\$\{idPrefix\}-state`\} name="state"/.test(block));
check("country is India or elsewhere", /<option value="Other">Other country<\/option>/.test(block));
check("choosing elsewhere frees the state and postcode",
  /setCountry\(e\.target\.value === "India" \? "India" : ""\); setState\(""\); setPincode\(""\)/.test(block));
check("it still posts the same field names, so the save actions are untouched",
  /name="address_line1"/.test(block) && /name="city"/.test(block) && /name="pincode"/.test(block) && /name="gstin"/.test(block),
  "Ravi: the existing vendor flow must keep working, with GST verification added");
check("the GST number can be verified from a profile too", /const r = await verifyGstin\(gstin\)/.test(block));

const studentProfile = readFileSync(join(import.meta.dirname, "..", "app/dashboard/profile/page.tsx"), "utf8");
check("the student profile uses it", /<ProfileAddressBlock/.test(studentProfile));
check("and no longer holds a free-text state box",
  !/name="state" defaultValue/.test(studentProfile),
  "one student's invoice read ‘State Code:-’ because this was free text");
const vendorProfile = readFileSync(join(import.meta.dirname, "..", "app/supporter/profile/page.tsx"), "utf8");
check("the vendor profile uses it", /<ProfileAddressBlock/.test(vendorProfile));
check("the vendor's short 25-state list is gone",
  !/const STATES = \["Delhi"/.test(vendorProfile),
  "it omitted eleven states and offered ‘Other’, which is not a GST state");

const profileAction = readFileSync(join(import.meta.dirname, "..", "app/dashboard/profile/actions.ts"), "utf8");
check("the student's country is saved", /country: nullable\(formData\.get\("country"\)\) \?\? "India"/.test(profileAction));
const supporterAction = readFileSync(join(import.meta.dirname, "..", "app/supporter/actions.ts"), "utf8");
check("the vendor's country and registered name are saved",
  /country: s\("country"\)/.test(supporterAction) && /trade_name: s\("trade_name"\)/.test(supporterAction));

// ── sponsor and recipient, kept apart ─────────────────────────────────────
// "Recipient section currently has only one Address field… Sponsor Billing
//  section currently has only one Address field… These details should be
//  maintained separately and used for the Sponsor's invoice/billing."
const giftAct = readFileSync(join(import.meta.dirname, "..", "app/gift/actions.ts"), "utf8");
check("a gift carries two addresses in parts, not two paragraphs",
  /recipient: \{ name: string; email: string; phone\?: string; attempt\?: string; addr\?: Address \}/.test(giftAct) &&
  /billing: \{ name: string; gstin\?: string; tradeName\?: string; addr\?: Address \}/.test(giftAct));
check("the tax split is decided by the SPONSOR's state", /computeGst\(amount, bAddr\.state, s\)/.test(giftAct));
check("whether a parcel can go is now read, not guessed",
  /\(rAddr\.country \|\| "India"\)\.toLowerCase\(\) === "india" && \/\^\\d\{6\}\$\/\.test\(rAddr\.pincode\)/.test(giftAct),
  "looksPostableInIndia was inspecting a blob of prose");
check("both are stored in parts as well as in words",
  /recipient_addr: rAddr/.test(giftAct) && /billing_addr: bAddr/.test(giftAct));
const giftForm = readFileSync(join(import.meta.dirname, "..", "app/gift/GiftForm.tsx"), "utf8");
check("the gift form asks each in separate fields",
  /<AddressFields idPrefix="gr"/.test(giftForm) && /<AddressFields idPrefix="gb"/.test(giftForm));
check("the sponsor's GST can be verified there too", /await verifyGstin\(bGstin\)/.test(giftForm));
check("no textarea is left pretending to be an address",
  !/<textarea rows=\{2\} value=\{rAddr\}/.test(giftForm) && !/<textarea rows=\{2\} value=\{bAddr\}/.test(giftForm));

const sell = readFileSync(join(import.meta.dirname, "..", "app/supporter/sell/SellForm.tsx"), "utf8");
check("a vendor sale bills the vendor and ships to the student",
  /recipient: \{ name: name\.trim\(\)[\s\S]{0,200}addr: toAddress\(/.test(sell) &&
  /billing: \{ name: billing\.name[\s\S]{0,140}addr: \{ \.\.\.billing\.addr/.test(sell),
  "his rule: the billing address is the vendor's, the shipping address is the student's");

// ── every enrolment, not only the first ───────────────────────────────────
const plans = readFileSync(join(import.meta.dirname, "..", "app/learn/[courseId]/plans/PricingCards.tsx"), "utf8");
check("buying a plan opens the review before anything else",
  /function buy\(tier: string\) \{\s*\n\s*setAskAddress\(tier\);/.test(plans),
  "the address used to be asked ONLY when the server refused for want of one — so a returning student was never asked at all");
check("the plan page uses the same shared step", /<CheckoutAddressStep/.test(plans));
check("the confirmed details are saved before the gateway opens",
  /await saveConfirmedDetails\(d\)/.test(plans));
check("payment happens after the save, not beside it",
  /if \(tier\) await payNow\(tier\);/.test(plans));
check("the billing address still lands in the columns the invoice reads",
  /address_line1: billing\.line1/.test(cart) && /state: billing\.state \|\| null/.test(cart));

console.log(fails === 0 ? "ok — checkout addresses" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
