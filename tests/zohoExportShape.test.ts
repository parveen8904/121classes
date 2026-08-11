import { readFileSync } from "node:fs";
import { invoicesCsv, paymentsCsv, type AccountRow } from "../lib/accountsExport";
import { zohoStateCode } from "../lib/indiaStates";

// THE FILE ZOHO ALREADY ACCEPTS.
//
// Checked against the two exports the office produced by hand
// (20260725_Export_Invoices.csv, 20260725_Export_Payments.csv). The point of
// this file is that the headings, their order and their vocabulary keep
// matching those, so the download drops into the same import screen without
// anybody re-mapping columns.
//
// Three of these are silent failures rather than loud ones — Zoho accepts the
// wrong value and files it wrongly:
//   · an ISO date imports as a different day;
//   · a Place of Supply that is not Zoho's two-letter code files against no
//     state at all, which surfaces at a return deadline;
//   · sending the taxable value as Item Price while Is Inclusive Tax is TRUE
//     overstates every sale by 18%.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

const UP = "/Users/parveensharma/.claude/uploads/65b79338-c6ef-4d70-841d-82c5d459fdab";
const theirInv = readFileSync(`${UP}/7aab5a51-20260725_Export_Invoices.csv`, "utf8").split(/\r?\n/);
const theirPay = readFileSync(`${UP}/13f46208-20260725_Export_Payments.csv`, "utf8").split(/\r?\n/);

const row: AccountRow = {
  table: "orders", id: "1", orderNo: "#10001", invoiceNo: "CAPS/26-27/0001", receiptNo: "20001",
  date: "2026-07-25T09:00:00Z", customer: "Parveen Shankar", email: "sankarpraveen608@gmail.com",
  phone: "352000000000", gstin: "", state: "Delhi",
  description: "Validity Extension- CA Inter Advance Accounting (REGULAR BATCH)",
  total: 1000, taxable: 0, cgst: 0, sgst: 0, igst: 0,
  status: "paid", razorpayOrderId: "order_X", razorpayPaymentId: "pay_SY89rVLNjTZmIK",
  zohoStatus: "pending", zohoInvoiceId: "", account: "Sales-Validity", hsn: "999293",
};

// ── The headings match theirs exactly, in their order ────────────────────
const ourInvHead = invoicesCsv([row]).replace(/^﻿/, "").split("\r\n")[0];
check(ourInvHead === theirInv[0], "invoice headings match the file Zoho accepts, in the same order");
const ourPayHead = paymentsCsv([row]).replace(/^﻿/, "").split("\r\n")[0];
check(ourPayHead === theirPay[0], "payment headings match, in the same order");

// ── The three that fail silently ─────────────────────────────────────────
const inv = invoicesCsv([row]).split("\r\n")[1];
check(inv.includes('"25/07/2026"'), `the date is DD/MM/YYYY, not ISO (row: ${inv.slice(0, 60)})`);
check(!/2026-07-25/.test(inv), "…and the ISO form does not appear anywhere in the row");
check(inv.includes('"DL"'), "Place of Supply is Zoho's two-letter code");
check(!/"Delhi"/.test(inv) && !/"07"/.test(inv), "…not the state name and not the GST number");
check(inv.includes('"1000"'), "Item Price is the GROSS amount, because Is Inclusive Tax is TRUE");
check(inv.includes('"TRUE"'), "Is Inclusive Tax is TRUE");
check(inv.includes('"GST18"') && inv.includes('"Tax Group"') && inv.includes('"18"'), "the tax group is spelled as Zoho spells it");
check(inv.includes('"999293"'), "the coaching SAC is on the line");
check(inv.includes('"10001"'), "PurchaseOrder carries the order number without our # prefix");
check(inv.includes('"pay_SY89rVLNjTZmIK"'), "Reference Number is the Razorpay PAYMENT id");

// ── Every state we sell to resolves to a code ────────────────────────────
for (const [name, code] of [
  ["Delhi", "DL"], ["Uttar Pradesh", "UP"], ["West Bengal", "WB"], ["Maharashtra", "MH"],
  ["Karnataka", "KA"], ["Telangana", "TS"], ["Odisha", "OD"], ["Uttarakhand", "UK"],
  ["Tamil Nadu", "TN"], ["Madhya Pradesh", "MP"], ["Himachal Pradesh", "HP"],
] as const) {
  check(zohoStateCode(name) === code, `${name} → ${code} (got "${zohoStateCode(name)}")`);
}
check(zohoStateCode("") === "", "an unknown state is left blank, never guessed");
check(zohoStateCode("226029") === "", "a PIN code never becomes a state code");
check(zohoStateCode("New Delhi") === "DL", "the everyday spelling still resolves");

// ── Payments: the running series, and only money that arrived ───────────
const pay = paymentsCsv([row, { ...row, id: "2", status: "created" }]).split("\r\n");
check(pay.length === 2, `only the paid row becomes a payment (got ${pay.length - 1})`);
check(pay[1].includes('"E-26-27/"'), "the payment prefix follows the financial year");
check(pay[1].includes('"000001"'), "the suffix is a six-digit running number");
check(pay[1].includes('"1,000.00"'), "the amount carries Zoho's thousands separator and two decimals");
check(pay[1].includes('"Razorpay Clearing"'), "it is deposited to the Razorpay clearing account");
check(pay[1].includes('"Invoice Payment"'), "the payment type is stated");

// The series must climb with the calendar, not with the screen's sort order.
const older = { ...row, id: "3", date: "2026-07-20T09:00:00Z", invoiceNo: "CAPS/26-27/0000" };
const two = paymentsCsv([row, older]).split("\r\n");
check(two[1].includes("CAPS/26-27/0000") && two[1].includes('"000001"'),
  "the oldest payment takes the first number, whatever order the screen was in");

console.log(fails === 0 ? "PASS  Zoho exports match the accepted file: DD/MM/YYYY, two-letter state, gross amount inclusive" : "");
process.exit(fails === 0 ? 0 : 1);
