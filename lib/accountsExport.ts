import { createServiceClient } from "@/lib/supabase/service";

// WHAT THE ACCOUNTS DEPARTMENT NEEDS, WHICH IS NOT WHAT THE SALES DESK NEEDS.
//
// The sales export answers "what did we sell". Accounts asks a different
// question: does what Razorpay says match what Zoho Books has, and where does
// it not. Those two reports want different columns, different filters and
// different rows, and trying to serve both from one file is how the working one
// gets broken.
//
// So this is separate — a separate query, separate exports, and the existing
// "Download Excel — everything" is not touched at all.
//
// Two exports, because Zoho Books imports them separately: an INVOICE is the
// document raised, a PAYMENT is the money received against it. They go into
// different Zoho screens and cannot be one file.

export type AccountRow = {
  table: "orders" | "book_orders" | "gift_orders";
  id: string;
  orderNo: string;
  invoiceNo: string;
  receiptNo: string;
  date: string;
  customer: string;
  email: string;
  gstin: string;
  state: string;
  description: string;
  /** GST-inclusive amount actually charged. */
  total: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  status: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  zohoStatus: string;
  zohoInvoiceId: string;
};

export type AccountsFilter = {
  from?: string;   // YYYY-MM-DD, IST
  to?: string;
  /** paid | created | failed | refunded — the sale's own state, not Zoho's. */
  state?: string;
  /** pending | approved | posted | skipped — where it stands with Zoho. */
  zoho?: string;
};

const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

/**
 * The states each table calls the same thing.
 *
 * A vendor sale that has been fulfilled is "provisioned", a book that has gone
 * out is "dispatched", and a subscription is simply "paid" — all three mean the
 * money arrived. Accounts should not have to learn three vocabularies to filter
 * one report.
 */
export const ACCOUNT_STATES: Record<string, string[]> = {
  paid: ["paid", "provisioned", "dispatched", "delivered"],
  created: ["created", "pending"],
  failed: ["failed"],
  refunded: ["refunded", "cancelled"],
};

export function matchesState(status: string, want: string): boolean {
  if (!want) return true;
  return (ACCOUNT_STATES[want] ?? [want]).includes(status);
}

export async function accountRows(f: AccountsFilter): Promise<AccountRow[]> {
  const svc = createServiceClient();
  const from = day(f.from) ? new Date(`${day(f.from)}T00:00:00+05:30`).toISOString() : null;
  const to = day(f.to) ? new Date(`${day(f.to)}T23:59:59.999+05:30`).toISOString() : null;

  const range = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T): T => {
    let out = q;
    if (from) out = out.gte("created_at", from);
    if (to) out = out.lte("created_at", to);
    return out;
  };

  const [subs, books, gifts] = await Promise.all([
    range(svc.from("orders")
      .select("id, order_no, invoice_no, receipt_no, amount_inr, status, created_at, razorpay_order_id, razorpay_payment_id, zoho_status, zoho_invoice_id, subjects:subject_id(title), profiles:student_id(full_name, business_name, email, gstin, state)")
      .order("created_at", { ascending: false }).limit(2000) as never) as never,
    range(svc.from("book_orders")
      .select("id, order_no, invoice_no, receipt_no, amount_inr, status, created_at, razorpay_order_id, razorpay_payment_id, zoho_status, zoho_invoice_id, guest_contact, ship_to, items")
      .order("created_at", { ascending: false }).limit(2000) as never) as never,
    range(svc.from("gift_orders")
      .select("id, order_no, invoice_no, receipt_no, amount_inr, taxable_value, cgst, sgst, igst, status, created_at, razorpay_order_id, razorpay_payment_id, billing_name, billing_gstin, billing_state, recipient_name, recipient_email, months, subjects:subject_id(title)")
      .order("created_at", { ascending: false }).limit(2000) as never) as never,
  ]) as unknown as { data: Record<string, never>[] | null }[];

  const out: AccountRow[] = [];
  const str = (v: unknown) => String(v ?? "");
  const num = (v: unknown) => Number(v) || 0;

  for (const r of subs.data ?? []) {
    const p = r.profiles as unknown as Record<string, string | null> | null;
    out.push({
      table: "orders", id: str(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "",
      invoiceNo: str(r.invoice_no), receiptNo: r.receipt_no ? String(r.receipt_no) : "",
      date: str(r.created_at),
      customer: str(p?.business_name || p?.full_name), email: str(p?.email),
      gstin: str(p?.gstin), state: str(p?.state),
      description: str((r.subjects as unknown as { title?: string } | null)?.title) || "Subscription",
      total: num(r.amount_inr), taxable: 0, cgst: 0, sgst: 0, igst: 0,
      status: str(r.status),
      razorpayOrderId: str(r.razorpay_order_id), razorpayPaymentId: str(r.razorpay_payment_id),
      zohoStatus: str(r.zoho_status), zohoInvoiceId: str(r.zoho_invoice_id),
    });
  }

  for (const r of books.data ?? []) {
    const s = (r.ship_to ?? {}) as Record<string, string | undefined>;
    const g = (r.guest_contact ?? {}) as Record<string, string | undefined>;
    out.push({
      table: "book_orders", id: str(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "",
      invoiceNo: str(r.invoice_no), receiptNo: r.receipt_no ? String(r.receipt_no) : "",
      date: str(r.created_at),
      customer: str(s.name || g.name), email: str(s.email || g.email),
      gstin: "", state: str(s.state),
      description: `Printed books × ${((r.items ?? []) as unknown as unknown[]).length} line(s)`,
      total: num(r.amount_inr), taxable: 0, cgst: 0, sgst: 0, igst: 0,
      status: str(r.status),
      razorpayOrderId: str(r.razorpay_order_id), razorpayPaymentId: str(r.razorpay_payment_id),
      zohoStatus: str(r.zoho_status), zohoInvoiceId: str(r.zoho_invoice_id),
    });
  }

  for (const r of gifts.data ?? []) {
    out.push({
      table: "gift_orders", id: str(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "",
      invoiceNo: str(r.invoice_no), receiptNo: r.receipt_no ? String(r.receipt_no) : "",
      date: str(r.created_at),
      customer: str(r.billing_name || r.recipient_name), email: str(r.recipient_email),
      gstin: str(r.billing_gstin), state: str(r.billing_state),
      description: `${str((r.subjects as unknown as { title?: string } | null)?.title) || "Subject"} — ${str(r.months)} months (vendor / sponsored)`,
      // A vendor sale is the only one that already stores its own tax split,
      // worked out at the moment of sale. Where it exists it is used rather
      // than recomputed, so the report agrees with the invoice that was issued.
      total: num(r.amount_inr), taxable: num(r.taxable_value),
      cgst: num(r.cgst), sgst: num(r.sgst), igst: num(r.igst),
      status: str(r.status),
      razorpayOrderId: str(r.razorpay_order_id), razorpayPaymentId: str(r.razorpay_payment_id),
      zohoStatus: "", zohoInvoiceId: "",
    });
  }

  const filtered = out.filter((r) => matchesState(r.status, f.state ?? ""))
    .filter((r) => !f.zoho || (r.zohoStatus || "none") === f.zoho);
  filtered.sort((a, b) => b.date.localeCompare(a.date));
  return filtered;
}

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
const isoDay = (iso: string) => (iso ? iso.slice(0, 10) : "");

/**
 * EXPORT INVOICES — the documents raised.
 *
 * Column names follow Zoho Books' own invoice import vocabulary so the file can
 * be mapped without renaming every heading by hand. Only rows that actually
 * have an invoice number appear: an abandoned checkout raised no document and
 * has nothing to import.
 */
export function invoicesCsv(rows: AccountRow[]): string {
  const head = [
    "Invoice Date", "Invoice Number", "Invoice Status", "Customer Name", "Email",
    "GST Treatment", "GSTIN", "Place of Supply",
    "Item Name", "Item Total", "Taxable Amount", "CGST", "SGST", "IGST", "Total",
    "Order Number", "Receipt Number", "Payment Reference", "Zoho Status", "Zoho Invoice ID",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    if (!r.invoiceNo) continue;
    lines.push([
      esc(isoDay(r.date)), esc(r.invoiceNo), esc(r.status), esc(r.customer), esc(r.email),
      esc(r.gstin ? "business_gst" : "consumer"), esc(r.gstin), esc(r.state),
      esc(r.description), esc(r.total.toFixed(2)),
      esc(r.taxable ? r.taxable.toFixed(2) : ""), esc(r.cgst ? r.cgst.toFixed(2) : ""),
      esc(r.sgst ? r.sgst.toFixed(2) : ""), esc(r.igst ? r.igst.toFixed(2) : ""),
      esc(r.total.toFixed(2)),
      esc(r.orderNo), esc(r.receiptNo), esc(r.razorpayPaymentId || r.razorpayOrderId),
      esc(r.zohoStatus), esc(r.zohoInvoiceId),
    ].join(","));
  }
  return "﻿" + lines.join("\r\n");
}

/**
 * EXPORT PAYMENTS — the money received.
 *
 * Only sales where money actually arrived. A created-but-abandoned checkout is
 * not a payment, and importing one would put a receipt in the books against a
 * customer who never paid.
 */
export function paymentsCsv(rows: AccountRow[]): string {
  const head = [
    "Payment Date", "Payment Number", "Customer Name", "Email",
    "Invoice Number", "Amount", "Payment Mode", "Deposit To",
    "Reference Number", "Razorpay Order ID", "Order Number", "Description",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    if (!matchesState(r.status, "paid")) continue;
    lines.push([
      esc(isoDay(r.date)), esc(r.receiptNo), esc(r.customer), esc(r.email),
      esc(r.invoiceNo), esc(r.total.toFixed(2)), esc("Razorpay"), esc("Razorpay"),
      esc(r.razorpayPaymentId), esc(r.razorpayOrderId), esc(r.orderNo), esc(r.description),
    ].join(","));
  }
  return "﻿" + lines.join("\r\n");
}
