// MONEY TAKEN, ORDER MISSING.
//
// 3 September 2026, from the team: "Payment received on razorpay but order not
// created on our website, kindly check and resolve on urgent basis." A ₹2,500
// CA Final FR book set, paid by a buyer on 2 September, captured by Razorpay —
// and no row anywhere in this database. The buyer had no account either, so
// there was not even a person to apologise to.
//
// The cause was structural. A subscription or a gift is written to our tables
// at "created" BEFORE the buyer goes to Razorpay, so a dropped browser leaves a
// row that lib/paymentReconcile.ts can find and finish. A BOOK order was only
// ever written in the success callback, which runs in the buyer's browser after
// the money has moved — so losing that half-second left the money at Razorpay
// and nothing here at all. There was no stuck row to sweep, because there was
// no row.
//
//   node --experimental-strip-types tests/bookOrderRecovery.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");
const finish = read("lib/bookOrderFinish.ts");
const cart = read("app/books/cartActions.ts");
const single = read("app/books/[id]/payActions.ts");
const cron = read("app/api/cron/reconcile-payments/route.ts");

/* ── one implementation, on the server ───────────────────────────────────── */

check("neither checkout writes the order itself any more",
  !/from\("book_orders"\)\s*\.?\s*\n?\s*\.insert/.test(cart) && !/from\("book_orders"\)[\s\S]{0,40}\.insert/.test(single),
  "an order written only in the buyer's browser is an order that vanishes when the browser does");

check("both checkouts hand off to the shared finisher",
  /finishBookOrderFromRazorpay\(input\.razorpay_order_id, input\.razorpay_payment_id\)/.test(cart) &&
  /finishBookOrderFromRazorpay\(input\.razorpay_order_id, input\.razorpay_payment_id\)/.test(single),
  "one implementation, so a recovered order and a normal one cannot drift apart");

check("the finisher still insists on a paid Razorpay order",
  /order\.status !== "paid"/.test(finish));
check("…and on it being one of ours",
  /kind !== "book" && kind !== "book_cart"/.test(finish),
  "money taken through a payment link has no order of ours to rebuild and must be left alone");

/* ── it must never bill anybody twice ────────────────────────────────────── */

// The screenshot showed the ₹2,500 twice: one captured, one failed. A retry is
// ordinary, and exactly one order may come of it.
const guardAt = finish.indexOf('.eq("razorpay_order_id", rzpOrderId)');
const insertAt = finish.indexOf('.from("book_orders").insert');
check("it checks for an existing order BEFORE inserting one",
  guardAt > 0 && insertAt > 0 && guardAt < insertAt,
  "a refreshed callback and the sweep can arrive on the same order at the same moment");
check("a duplicate-key race is treated as success, not failure",
  /duplicate key/i.test(finish) && /created: false/.test(finish),
  "if the row exists the job is done, whoever did it");

/* ── the sweep looks where the money is, not where the row is ────────────── */

check("the sweep starts from Razorpay's captured payments",
  /listRazorpayPayments/.test(finish) && /p\.status === "captured"/.test(finish),
  "our own tables cannot show an order that was never written");
check("a failed payment can never produce an order",
  /status === "captured" && p\.order_id/.test(finish));
check("payments already accounted for anywhere are skipped",
  /from\("book_orders"\)[\s\S]{0,400}from\("orders"\)[\s\S]{0,400}from\("gift_orders"\)/.test(finish),
  "a subscription's Razorpay order is not a missing book order");

/* ── and it actually runs ────────────────────────────────────────────────── */

check("the quarter-hourly cron runs the book sweep as well as the stuck-row one",
  /reconcileAllStuck\(/.test(cron) && /recoverUnrecordedBookOrders\(/.test(cron));
check("a failure in one sweep does not take the other down",
  /recoverUnrecordedBookOrders\([\s\S]{0,80}\.catch\(/.test(cron));

/* ── the invoice ─────────────────────────────────────────────────────────── */

check("every book order gets its tax invoice, not just cart ones",
  /issueOrderInvoice/.test(finish) && !/issueOrderInvoice/.test(single),
  "the single-book door never raised one; a buyer's right to an invoice does not depend on which button they pressed");

console.log(fails === 0 ? "ok — book order recovery" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
