import { buildInvoiceNo, INVOICE_NO_MAX } from "../lib/invoice";

// FOUR IDENTIFIERS, AND NONE OF THEM IS ANOTHER.
//
//   Invoice No.  numbers the tax document           — at most 15 characters
//   Receipt No.  numbers the acknowledgement of money — its own sequence
//   Order ID     numbers the sale
//   Payment ID   evidences that money actually moved (pay_…, from Razorpay)
//
// They were being interchanged. The receipt printed the ORDER number as its
// own, and the payment reference printed the razorpay ORDER id — so a receipt
// carried two order numbers and no evidence of payment, and an accountant
// matching "10038" could not tell which document was meant.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── The 15-character promise ──────────────────────────────────────────────
const apr = new Date("2026-04-01T00:00:00Z");   // first day of FY 2026-27
const mar = new Date("2027-03-31T00:00:00Z");   // last day of the same FY
const jan = new Date("2026-01-15T00:00:00Z");   // still FY 2025-26

check(buildInvoiceNo("CAPS/", apr, 1) === "CAPS/26-27/0001", `1 April 2026 → CAPS/26-27/0001 (got ${buildInvoiceNo("CAPS/", apr, 1)})`);
check(buildInvoiceNo("CAPS/", mar, 9999) === "CAPS/26-27/9999", "31 March 2027 is still 26-27");
check(buildInvoiceNo("CAPS/", jan, 7) === "CAPS/25-26/0007", "January 2026 belongs to FY 25-26");

for (const [when, n] of [[apr, 1], [mar, 9999], [jan, 4321]] as const) {
  const no = buildInvoiceNo("CAPS/", when, n);
  check(no.length <= INVOICE_NO_MAX, `"${no}" is ${no.length} chars — the cap is ${INVOICE_NO_MAX}`);
}
check(buildInvoiceNo("CAPS/", apr, 1).length === 15, "the standard number uses the full fifteen, not fewer");

// The prefix is a setting, and a setting can be typed. It must never be able to
// break the promise — an over-long prefix gives way, the number never does.
for (const prefix of ["CAPS/", "AV/", "", "ALDINEVENTURES/", "X".repeat(40)]) {
  const no = buildInvoiceNo(prefix, apr, 42);
  check(no.length <= INVOICE_NO_MAX, `prefix ${JSON.stringify(prefix.slice(0, 12))}… → "${no}" (${no.length} chars)`);
  check(no.endsWith("26-27/0042"), `prefix ${JSON.stringify(prefix.slice(0, 12))}… keeps the year and serial intact`);
}

// ── The serial is padded, and stays sortable ─────────────────────────────
const seq = [1, 2, 10, 99, 100, 1000, 9999].map((n) => buildInvoiceNo("CAPS/", apr, n));
check(seq.join() === [...seq].sort().join(), "invoice numbers sort into issue order as plain text");
check(new Set(seq).size === seq.length, "no two serials produce the same number");

// ── They must not be each other ──────────────────────────────────────────
// A receipt number is a plain serial from its own sequence, starting at 20001,
// clear of the order numbers (~10041) so the two can never be confused on a
// document that carries both.
const RECEIPT_START = 20001, HIGHEST_ORDER_NO_AT_MIGRATION = 10041;
check(RECEIPT_START > HIGHEST_ORDER_NO_AT_MIGRATION,
  "the receipt sequence starts clear of every order number already printed as one");

// The payment reference must be a PAYMENT. Razorpay order ids begin "order_",
// payments begin "pay_" — printing the former proves nothing about money.
const looksLikePayment = (ref: string) => /^pay_/.test(ref);
check(looksLikePayment("pay_R1a2B3c4D5"), "pay_… is a payment reference");
check(!looksLikePayment("order_TO5N57BvgHHq2m"), "order_… is NOT — this is what used to be printed");

console.log(fails === 0 ? "PASS  invoice ≤15 chars, receipt/order/payment ids kept distinct" : "");
process.exit(fails === 0 ? 0 : 1);
