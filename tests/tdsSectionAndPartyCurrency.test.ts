// FOUR CORRECTIONS FROM THE ACCOUNTS DESK, 3 SEPTEMBER 2026.
//
//   "you are confusing gst with tds. you said tds not enabled but it is. u are
//    looking at gst instead of tds. cmg bill has issue. supplier invoice onlt
//    list with A but not others. in case of supabase you are mixing inr with
//    dollor supplier."
//
// All four were real, and checked against his live books before being fixed.
//
// 1. TDS IS ENABLED. The organisation reports is_invoice_pmt_tds_allowed and
//    holds a full TDS master. zohoOutgoing asked /settings/taxes with
//    filter_by=Taxes.Tds, which answers EMPTY on his org, and reported "no
//    matching TDS tax in Zoho" on every sale a customer withheld on. Without
//    that filter the same endpoint returns the six GST rates — GST0/5/18 and
//    IGST0/5/18 — and the old code matched on the percentage alone, so a 5%
//    withholding would have taken GST5. Looking at GST and calling it TDS.
//
// 2. THE CMG BILL. Right in every respect — professional fees, 393(2) Sl.17,
//    ₹7,500 on ₹75,000 — and Zoho threw it out: "The tax Dividend associated
//    on the transaction is either expired or is applicable for a future date".
//    The posting path had its own matcher, an `||`, that fell through to the
//    first rate at 10% when the section name did not match verbatim. In his
//    master that is dividend withholding under 194, expired. matchTds existed
//    and said not to do this; the posting path never called it.
//
// 3. THE SUPPLIER LIST. Zoho's /contacts IGNORES contact_type — asked for
//    vendors it returns 200 contacts of which 196 are students and echoes
//    applied_filter: Status.All. Sorted by name, thousands of students deep,
//    the dropdown was the letter A and no supplier was reachable at all.
//
// 4. SUPABASE. Zoho reads a payment's amount in the CONTACT'S currency, and
//    Supabase Inc. is a USD vendor. A ₹28,500 card charge answered as a
//    payment to them posts as $28,500 — about ₹27 lakh.
//
//   node --experimental-strip-types tests/tdsSectionAndPartyCurrency.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchTds, tdsChoicesAt, type RawTax } from "../lib/tdsMatch.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
const outgoing = read("lib/zohoOutgoing.ts");
const bills = read("lib/providerBills.ts");
const party = read("lib/zohoParty.ts");
const bank = read("lib/bankStatements.ts");
const classify = read("app/admin/zoho/VaultClassify.tsx");

/* ── 2. the CMG bill, as his master actually looks ───────────────────────── */

const master: RawTax[] = [
  { tax_id: "d", tax_name: "Dividend", tax_percentage: 10, end_date: "2026-03-31" },
  { tax_id: "p", tax_name: "393(2) - Sl.No.17 Professional Fees", tax_percentage: 10 },
  { tax_id: "c", tax_name: "393(1) Contractor", tax_percentage: 1 },
  { tax_id: "h", tax_name: "194H Commission", tax_percentage: 5, status: "Expired" },
];

const cmg = matchTds(master, "393(2) Sl.17", 10, "2026-08-31");
check("the CMG bill finds its own section",
  cmg?.tax_id === "p",
  `got ${cmg?.tax_name ?? "nothing"} — Zoho spells it "393(2) - Sl.No.17" where the desk holds "393(2) Sl.17"`);

check("…and never the other rate at ten percent",
  cmg?.tax_id !== "d",
  "Dividend under 194 on a bill for professional fees is a wrong challan and a wrong 26AS entry");

check("a named section with no answer in the master returns nothing, not a substitute",
  matchTds(master, "194J", 10, "2026-08-31") === null,
  "the bill then says the withholding must be applied by hand, which a person can see");

check("an expired rate is never picked",
  matchTds(master, "194H", 5, "2026-08-31") === null);

check("a rate outside its window on the BILL's date is not picked",
  matchTds([master[0]], "Dividend", 10, "2026-08-31") === null,
  "Zoho judges the bill's date, not today — that is what it refused CMG on");

check("…and the same rate inside its window is",
  matchTds([master[0]], "Dividend", 10, "2026-02-01")?.tax_id === "d");

check("with no section named, a single live rate at that percentage still answers",
  matchTds(master, "", 1)?.tax_id === "c");

check("with no section named and two candidates, it asks instead of guessing",
  matchTds([{ tax_id: "x", tax_name: "A", tax_percentage: 10 },
            { tax_id: "y", tax_name: "B", tax_percentage: 10 }], "", 10) === null);

/* ── and what his master ACTUALLY looks like ─────────────────────────────── */

// Read off the note Zoho's own refusal left on the CMG bill. Not one of these
// names carries a section number: Zoho names TDS by the NATURE of the payment.
// So "393(2) Sl.17" can never match, and both his rules use that same string —
// CMG at 10% for professional fees, FIRST FLY at 1% for courier work.
const his: RawTax[] = [
  { tax_id: "1", tax_name: "Commission or Brokerage", tax_percentage: 5 },
  { tax_id: "2", tax_name: "Dividend", tax_percentage: 10 },
  { tax_id: "3", tax_name: "Other Interest than securities", tax_percentage: 10 },
  { tax_id: "4", tax_name: "Payment of contractors HUF/Indiv", tax_percentage: 1 },
  { tax_id: "5", tax_name: "Professional Fees", tax_percentage: 10 },
  { tax_id: "6", tax_name: "Rent on land or furniture etc", tax_percentage: 10 },
  { tax_id: "7", tax_name: "TDS on Professional Fee", tax_percentage: 10 },
  { tax_id: "8", tax_name: "Professional Fees (Reduced)", tax_percentage: 7.5 },
];

check("his real master answers to no section at all",
  matchTds(his, "393(2) Sl.17", 10, "2026-08-31") === null,
  "which is why the bill must ask rather than match — and why it must not post detached");

check("the rate he picks himself is the one attached",
  matchTds(his, "393(2) Sl.17", 10, "2026-08-31", "5")?.tax_name === "Professional Fees",
  "the choice is kept on the supplier's rule; nothing is derived from the section");

check("a chosen rate that has since expired is still not attached",
  matchTds([{ ...his[4], end_date: "2026-03-31" }], "393(2) Sl.17", 10, "2026-08-31", "5") === null,
  "chosen in March is not the same as valid in August");

check("a chosen id that is not in the master answers nothing, not the next best",
  matchTds(his, "393(2) Sl.17", 10, "2026-08-31", "999") === null);

check("the short list offered is the live rates at the bill's own percentage",
  tdsChoicesAt(his, 10, "2026-08-31").map((t) => t.tax_id).join(",") === "2,3,5,6,7",
  "twenty-odd rates is a hunt; the ones at 10% are a choice");

check("…and it leaves out the reduced rate at another percentage",
  !tdsChoicesAt(his, 10, "2026-08-31").some((t) => /Reduced/.test(t.tax_name)));

check("the same section at FIRST FLY's rate offers the contractor rate, not professional fees",
  tdsChoicesAt(his, 1, "2026-08-31").map((t) => t.tax_name).join() === "Payment of contractors HUF/Indiv",
  "one section string, two natures — no rule of thumb spans that");

/* ── a withholding that cannot be attached stops the bill ────────────────── */

check("the bill refuses rather than posting with the withholding detached",
  /Zoho has no rate of that name[\s\S]{0,400}return fail|return fail\([\s\S]{0,200}no rate of that name/.test(bills),
  "CMG posted at ₹88,500 with its ₹7,500 of TDS detached — a return that will not tie");

check("…and the refusal names the live rates to choose between",
  /tdsChoicesAt\(taxes, Number\(p\.tds_rate\), onISO\)/.test(bills));

check("the chosen rate reaches the matcher from the proposal",
  /str\(p\.tds_tax_id\) \|\| null/.test(bills));

check("a GST rate is never returned for a TDS section",
  matchTds([{ tax_id: "g", tax_name: "GST5", tax_percentage: 5 },
            { tax_id: "i", tax_name: "IGST5", tax_percentage: 5 }], "393(1)", 5) === null,
  "this is the exact confusion he named: six GST rates are what the unfiltered endpoint returns");

/* ── 1. and both posting paths ask the right way ─────────────────────────── */

check("the sale path no longer uses the filter that answers empty",
  !/filter_by: "Taxes\.Tds"/.test(outgoing),
  "it returns nothing on his org, so every withheld sale reported TDS missing");

check("the sale path uses the shared TDS reader and matcher",
  /listZohoTds, matchTds/.test(outgoing));

check("the bill path uses matchTds rather than its own find",
  /const match = matchTds\(\s*\n?\s*taxes, String\(p\.tds_section/.test(bills));

check("…judged on the bill's own date",
  /String\(b\.bill_date \?\? ""\)\.slice\(0, 10\)/.test(bills));

check("the bill path's rate-or-section OR is gone",
  !/tax_name\.includes\(String\(p\.tds_section\)\) \|\|/.test(bills),
  "that OR is what attached Dividend to CMG");

check("the section reaches the ledger narration on a sale",
  /section: s\(d\.tds_section\) \|\| null/.test(outgoing),
  "it was hardcoded null, so the ledger read \"TDS 10%\" with nothing saying under what");

/* ── 3. the supplier list ────────────────────────────────────────────────── */

check("there is a supplier list drawn from our own books",
  /export async function listKnownSuppliers/.test(party));

check("…built from the bills and the rules, with the rule's spelling winning",
  /provider_bill_rules/.test(party) && /provider_bills/.test(party));

check("a supplier invoice is offered suppliers, not Zoho's contact book",
  /kind === "invoice"[\s\S]{0,200}props\.suppliers/.test(classify),
  "Zoho ignores contact_type, so that list is thousands of students beginning at A");

check("the contact list records why it cannot be the answer",
  /IGNORES contact_type/.test(party));

check("a truncated contact read is not cached as if it were complete",
  /if \(!short\) partyList = /.test(party),
  "ten minutes of a half list is worse than asking again");

/* ── 4. the rupee line and the dollar supplier ───────────────────────────── */

check("the party's own currency is read when a payment is posted",
  /currency: partyCurrency \} = await findOrCreateParty/.test(bank));

check("a rupee line to a foreign-currency party is refused",
  /partyCurrency && partyCurrency !== "INR"[\s\S]{0,120}return fail/.test(bank),
  "Zoho reads the amount in the CONTACT's currency: ₹28,500 posts as $28,500");

check("…and the refusal says how to book it instead",
  /Exchange Difference/.test(bank),
  "the card's real rate and Rule 115 differ — ₹27,505.64 for $300 is 91.685 against 95.00");

check("the refund direction refusal is still in place",
  /kind === "vendor_payment" && !isOut/.test(bank),
  "a refund is not a payment run backwards");

console.log(fails === 0 ? "ok — TDS sections and party currency" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
