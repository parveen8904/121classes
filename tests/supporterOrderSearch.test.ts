import { orderMatches, orderIdOf, categoryOf, type SupporterOrder } from "../app/supporter/OrderList";

// WHAT A VENDOR WILL ACTUALLY TYPE.
//
// They are on the phone to a student who says "I paid on the 3rd". What they
// have to search with is whatever the student can read out: a number off an
// invoice, an email address, or a mobile number — and the mobile will arrive
// with spaces, or dashes, or a +91 on the front, because that is how people
// write phone numbers. A search that only matches the exact stored string is a
// search that fails on the call.

const order = (over: Partial<SupporterOrder> = {}): SupporterOrder => ({
  id: "x", order_no: 10023,
  recipient_name: "Aarav Mehta",
  recipient_email: "Aarav.Mehta@Example.com",
  recipient_phone: "9810012674",
  recipient_attempt: null, tier: "gold", months: 12, amount_inr: 11800,
  invoice_no: "INV-0042", invoice_url: null, status: "provisioned",
  created_at: "2026-08-01T00:00:00Z", paid_at: null,
  subjects: { title: "Financial Reporting", courses: { title: "CA Final" } },
  ...over,
});

const cases: [string, boolean, string][] = [
  ["10023",            true,  "the order number as it is printed"],
  ["#10023",           true,  "with the hash they see on screen"],
  ["INV-0042",         true,  "the invoice number instead"],
  ["aarav.mehta@example.com", true, "email, in the case they type it"],
  ["AARAV.MEHTA@EXAMPLE.COM", true, "email, shouting"],
  ["example.com",      true,  "part of the email is enough"],
  ["9810012674",       true,  "the phone as stored"],
  ["98100 12674",      true,  "the phone with a space in it"],
  ["+91 98100 12674",  true,  "the phone with the country code"],
  ["981-001-2674",     true,  "the phone with dashes"],
  ["Financial",        true,  "the subject"],
  ["CA Final",         true,  "the category"],
  ["Aarav",            true,  "their name"],
  ["",                 true,  "an empty box shows everything"],
  ["   ",              true,  "so does whitespace"],
  ["10024",            false, "a different order number"],
  ["9999999999",       false, "a different phone"],
  ["someone@else.com", false, "a different email"],
];

let fails = 0;
for (const [query, want, why] of cases) {
  const got = orderMatches(order(), query);
  if (got !== want) {
    fails++;
    console.log(`FAIL  "${query}" → ${got}, expected ${want} (${why})`);
  }
}

// A row with nothing on it must not match everything, or a vendor searching for
// one student is handed every order with a missing phone number.
const empty = order({
  order_no: null, invoice_no: null, recipient_name: null,
  recipient_email: null, recipient_phone: null, subjects: null,
});
if (orderMatches(empty, "9810012674")) { fails++; console.log("FAIL  a blank row matched a real phone number"); }
if (orderMatches(empty, "10023")) { fails++; console.log("FAIL  a blank row matched a real order number"); }
if (!orderMatches(empty, "")) { fails++; console.log("FAIL  a blank row vanished from an empty search"); }

// The order id falls back to the invoice when there is no number yet, so a row
// is never shown to a vendor with nothing they can quote back to us.
if (orderIdOf(order({ order_no: null })) !== "INV-0042") { fails++; console.log("FAIL  no fallback to the invoice number"); }
if (orderIdOf(order({ order_no: null, invoice_no: null })) !== "") { fails++; console.log("FAIL  order id should be empty, not 'null'"); }

// Supabase hands an embedded course back as an object or as a one-item array
// depending on how it read the relation. Both must give the category.
if (categoryOf(order()) !== "CA Final") { fails++; console.log("FAIL  category from an object"); }
if (categoryOf(order({ subjects: { title: "x", courses: [{ title: "CA Intermediate" }] } })) !== "CA Intermediate") {
  fails++; console.log("FAIL  category from a one-item array");
}
if (categoryOf(order({ subjects: null })) !== "") { fails++; console.log("FAIL  category with no subject at all"); }

console.log(fails === 0 ? `PASS  supporter order search: ${cases.length} queries, blanks, and both embed shapes` : "");
process.exit(fails === 0 ? 0 : 1);
