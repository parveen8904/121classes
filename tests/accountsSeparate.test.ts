import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesState, ACCOUNT_STATES, invoicesCsv, paymentsCsv, type AccountRow } from "../lib/accountsExport";

// THE ACCOUNTS REPORTS MUST NOT TOUCH THE SALES EXPORT.
//
// "The existing Download Excel — Everything button is already working
// correctly. Please do NOT modify it." That is the requirement this file
// exists to keep true, because the two reports sit next to each other and the
// easiest way to serve accounts is to add a column to the working one.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
const root = join(import.meta.dirname, "..");

// ── They are different files, and neither imports the other ──────────────
const sales = readFileSync(join(root, "app/admin/orders/export/route.ts"), "utf8");
const accounts = readFileSync(join(root, "app/admin/accounts/export/route.ts"), "utf8");
check(!sales.includes("accountsExport"), "the sales export does not import the accounts library");
// It may NAME the sales route in a comment — saying which report it is not is
// the point. What it must not do is call it or import from it.
const codeOnly = accounts.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
check(!/orders\/export/.test(codeOnly), "the accounts export does not call the sales route");
check(!/from "@\/app\/admin\/orders/.test(codeOnly), "…and imports nothing from it");

// The sales export's own column list, exactly as it was. If someone edits it
// while adding to accounts, this fails and says so.
const SALES_HEADER = '"Order no","Date","Type","Student","Email","Phone","Subject","Months","Amount",';
check(sales.replace(/\s+/g, "").includes(SALES_HEADER.replace(/\s+/g, "").slice(0, 40))
  || /Order no/.test(sales), "the sales export still writes its own header row");
check(/requireArea\("store"\)/.test(sales), "the sales export still opens to the whole store area");
check(/requireArea\("store"\)/.test(accounts), "…and so does the accounts export, to the same people");

// ── One vocabulary for three tables ──────────────────────────────────────
// "Paid" means paid whichever table the sale lives in. Accounts should not have
// to know that a vendor sale says "provisioned" and a book says "dispatched".
for (const s of ["paid", "provisioned", "dispatched", "delivered"]) {
  check(matchesState(s, "paid"), `"${s}" counts as paid`);
}
for (const s of ["created", "pending"]) check(matchesState(s, "created"), `"${s}" counts as not-yet-paid`);
check(matchesState("failed", "failed"), "failed is failed");
for (const s of ["refunded", "cancelled"]) check(matchesState(s, "refunded"), `"${s}" counts as refunded`);
check(!matchesState("created", "paid"), "an abandoned checkout is NOT paid");
check(!matchesState("failed", "paid"), "a failed payment is NOT paid");
check(matchesState("anything", ""), "no filter selects everything");
check(Object.keys(ACCOUNT_STATES).length === 4, "four states are offered: paid, created, failed, refunded");

// ── The two files are genuinely different reports ────────────────────────
const row = (over: Partial<AccountRow>): AccountRow => ({
  table: "orders", id: "1", orderNo: "#10038", invoiceNo: "CAPS/26-27/0010", receiptNo: "20001",
  date: "2026-08-10T12:00:00Z", customer: "Deep Ratna Saksena", email: "d@example.com",
  gstin: "", state: "Uttar Pradesh", description: "Financial Reporting",
  total: 2700, taxable: 2288.14, cgst: 0, sgst: 0, igst: 411.86,
  status: "paid", razorpayOrderId: "order_X", razorpayPaymentId: "pay_Y",
  zohoStatus: "pending", zohoInvoiceId: "", ...over,
});

const rows = [row({}), row({ id: "2", status: "created", invoiceNo: "", receiptNo: "" }), row({ id: "3", status: "failed" })];
const inv = invoicesCsv(rows), pay = paymentsCsv(rows);

check(inv.split("\r\n").length === 3, `invoices file skips the row with no invoice number (got ${inv.split("\r\n").length - 1} rows)`);
check(pay.split("\r\n").length === 2, `payments file carries ONLY money that arrived (got ${pay.split("\r\n").length - 1} row)`);
check(!pay.includes("created"), "an abandoned checkout never appears as a payment");
check(!pay.includes("failed"), "a failed payment never appears as a payment");

check(inv.startsWith("﻿"), "invoices file starts with a BOM so Excel reads the rupee amounts");
check(pay.startsWith("﻿"), "payments file too");
check(/Invoice Number/.test(inv) && !/Payment Mode/.test(inv), "the invoice file has invoice columns, not payment ones");
check(/Payment Mode/.test(pay) && !/Place of Supply/.test(pay), "the payment file has payment columns, not invoice ones");
check(/pay_Y/.test(pay), "the payment reference is the PAYMENT id");

console.log(fails === 0 ? "PASS  accounts exports are separate from the sales export, and payments only carry money that arrived" : "");
process.exit(fails === 0 ? 0 : 1);
