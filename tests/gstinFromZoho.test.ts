// A GSTIN, ANSWERED OUT OF HIS OWN BOOKS.
//
// "verify GST not working" — 3 September 2026, on a perfectly valid number.
// It was working: 23ABGCS2200J1ZR passes its checksum, carries PAN ABGCS2200J
// and encodes state 23, Madhya Pradesh. What it could not do was fetch the
// trade name, because the GSTN has no free public API and no commercial lookup
// is subscribed to. The screen reported that in amber, which reads as a fault.
//
// His answer: "Get it done from Zoho."
//
// He is right, and it is the cheaper idea. A GSTIN this desk cares about is
// almost always a party already in Zoho Books, and Zoho holds their registered
// name and billing address keyed by that very number. The subscription is
// already paid for. So Verify now asks the books before it gives up.
//
//   node --experimental-strip-types tests/gstinFromZoho.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkGstin } from "../lib/gstin.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
const party = read("lib/zohoParty.ts");
const cart = read("app/books/cartActions.ts");
const profile = read("app/components/ProfileAddressBlock.tsx");
const checkout = read("app/components/CheckoutAddressStep.tsx");

/* ── the number itself was never in doubt ────────────────────────────────── */

const ravi = checkGstin("23ABGCS2200J1ZR");
check("the number he reported as failing is valid", ravi.ok, ravi.problem ?? "");
check("…and everything checkable offline was already known",
  ravi.pan === "ABGCS2200J" && ravi.state === "Madhya Pradesh" && ravi.stateCode === "23",
  JSON.stringify(ravi));

/* ── the lookup must not answer with the wrong party ─────────────────────── */

const fn = party.slice(party.indexOf("export async function findPartyByGstin"));

check("it searches Zoho contacts by the number",
  /"\/contacts", \{ query: \{ search_text: want \} \}/.test(fn));

check("it CONFIRMS the GSTIN on the row it found",
  /String\(c\.gst_no \?\? ""\)\.trim\(\)\.toUpperCase\(\) === want/.test(fn),
  "Zoho's search is a contains-match across fields; a number sitting in somebody's notes would otherwise hand back the wrong party, and their address would go onto an invoice");

check("a number belonging to nobody in the books returns nothing, not a guess",
  /if \(!hit\) return null;/.test(fn));

check("it refuses anything that is not fifteen characters",
  /if \(want\.length !== 15\) return null;/.test(fn));

check("the address comes from the contact itself, not the list row",
  /\/contacts\/\$\{hit\.contact_id\}/.test(fn),
  "the list endpoint does not carry billing_address");

check("names are taken exactly as the books spell them",
  /Exactly as the books spell it/.test(fn),
  "a name on a tax invoice is not ours to tidy — the same rule as lib/gstin.ts");

/* ── it is a fallback, never a replacement for a real lookup ─────────────── */

check("a subscribed GST lookup still wins when there is one",
  cart.indexOf("if (look.ok)") < cart.indexOf("findPartyByGstin"),
  "the government record is the better authority; the books are what we have");

check("a failure asking Zoho leaves the number verified rather than erroring",
  /catch \{ \/\* the number is still verified; only the name went unanswered \*\/ \}/.test(cart));

/* ── THE SCREENS NO LONGER VERIFY ANYTHING ───────────────────────────────── */

// "Please remove the Verify button for GST number verification wherever it has
// been added. We do not require the GST verification functionality" — the team,
// 4 September 2026. The checks above still guard lib/gstin.ts, which is used by
// the accounts desk to read a GSTIN off a supplier invoice; what was removed is
// the BUTTON a customer saw and the message under it.
for (const [name, src] of [["the profile block", profile], ["the checkout step", checkout]] as const) {
  check(`${name} has no Verify button`, !/>\s*\{?\s*(checking|gstBusy)[^]*?Verify/.test(src) && !/"Verify"/.test(src),
    "removed on the team's instruction — the number is typed and taken as given");
  check(`${name} does not call the verification action`, !/verifyGstin/.test(src));
  check(`${name} keeps no verification message`, !/gstNote|setNote\(/.test(src),
    "the message had to go with the button, or the screen explains a control that is not there");
  check(`${name} still takes the number and the trade name`,
    /name="gstin"|setGstin\(/.test(src) && /trade|tradeName|setBName/i.test(src),
    "removing the check must not remove the fields the invoice needs");
}

console.log(fails === 0 ? "ok — GSTIN from Zoho" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
