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

/* ── and the screen says where the details came from ─────────────────────── */

for (const [name, src] of [["the profile block", profile], ["the checkout step", checkout]] as const) {
  check(`${name} does not call a Zoho record "the GST records"`,
    /from your Zoho Books/.test(src),
    "claiming government authority for a name copied out of our own books is a small lie on a tax invoice");
  check(`${name} asks for the name typed when nobody matches`,
    /typeTheName/.test(src) && /exactly as it appears on the certificate|fill in the name and address yourself/.test(src));
  check(`${name} reports a valid-but-unknown number in green, not amber`,
    /!r\.configured[\s\S]{0,900}tone: "ok"/.test(src),
    "reporting a successful check as a warning is what got this passed on as 'not working'");
}

console.log(fails === 0 ? "ok — GSTIN from Zoho" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
