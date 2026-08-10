import { chosenStates, statusesFor, matchesState, ORDER_STATES } from "../lib/orderStatus";

// THE BUG THIS EXISTS TO STOP COMING BACK.
//
// A completed supporter sale has the status "provisioned" — never "paid". So
// ticking "Paid" on the sales page excluded every vendor order the business had
// ever taken, from the register AND from the download, and nothing said so.
// The register simply read short.
//
// Anyone later adding a table, or renaming a status, has to keep these true.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── The one that broke ──────────────────────────────────────────────────────
check(matchesState("gift_orders", ["paid"], "provisioned"),
  'ticking Paid must keep a supporter sale, whose status is "provisioned"');
check(statusesFor("gift_orders", ["paid"]).includes("provisioned"),
  "the query for paid supporter sales must ask for provisioned rows");

// A posted book was paid for first; leaving it out would hide the book takings.
check(matchesState("book_orders", ["paid"], "dispatched"), "a dispatched book counts as paid");
check(matchesState("book_orders", ["paid"], "delivered"), "a delivered book counts as paid");

// ── And the ones that must NOT be swept in with it ─────────────────────────
check(!matchesState("gift_orders", ["paid"], "created"), "an abandoned supporter checkout is not paid");
check(!matchesState("orders", ["paid"], "created"), "an abandoned website checkout is not paid");
check(!matchesState("orders", ["failed"], "paid"), "a paid order is not a failed one");
check(!matchesState("book_orders", ["paid"], "cancelled"), "a cancelled book is not paid");

// ── Nothing ticked means everything, on every table ────────────────────────
for (const table of ["orders", "gift_orders", "book_orders"] as const) {
  check(matchesState(table, [], "anything at all"), `${table}: no choice means no filter`);
  check(statusesFor(table, []).length === 0, `${table}: no choice asks for no particular status`);
}

// ── Never send a table a word it has never heard of ────────────────────────
// book_orders.status is a Postgres enum: a value outside it is an ERROR, not an
// empty result, and PostgREST reports it in a field that is easy not to read.
const BOOK_ENUM = ["paid", "dispatched", "delivered", "cancelled"];
for (const state of ORDER_STATES) {
  for (const v of statusesFor("book_orders", [state])) {
    check(BOOK_ENUM.includes(v), `book_orders would be asked for "${v}", which is not in its enum`);
  }
}

// ── Only the words we actually offer come off the URL ──────────────────────
check(chosenStates("paid,created").join() === "paid,created", "reads the ticked boxes");
check(chosenStates("paid, PAID ,paid").length === 3, "does not deduplicate — the caller may repeat a box");
check(chosenStates("provisioned").length === 0, "our internal word is not a choice a person can send");
check(chosenStates("'; drop table orders; --").length === 0, "anything unrecognised is dropped");
check(chosenStates(null).length === 0, "no parameter at all is fine");
check(chosenStates(undefined).length === 0, "an absent parameter is fine");

console.log(fails === 0 ? "PASS  order status: paid means provisioned for a supporter sale, and dispatched for a book" : "");
process.exit(fails === 0 ? 0 : 1);
