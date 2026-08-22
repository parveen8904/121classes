import { createServiceClient } from "@/lib/supabase/service";
import { zohoStateCode } from "@/lib/indiaStates";

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
  /** Private storage URL of the invoice PDF, for the clickable invoice number. */
  invoiceUrl: string;
  receiptNo: string;
  date: string;
  customer: string;
  email: string;
  phone: string;
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
  /** The Zoho ledger this sale is booked to — different for books and classes. */
  account: string;
  /** Services carry the coaching SAC; printed books are goods with their own HSN. */
  hsn: string;
};

export type AccountsFilter = {
  from?: string;   // YYYY-MM-DD, IST
  to?: string;
  /** paid | created | failed | refunded — the sale's own state, not Zoho's. */
  state?: string;
  /** pending | approved | posted | skipped — where it stands with Zoho. */
  zoho?: string;
  /** Free-text search: order no, invoice no, email or phone. */
  q?: string;
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

  // A search should find a record however old it is, not just within the recent
  // screenful — so when searching we scan far more history. The normal view
  // stays capped for speed.
  const searching = !!(f.q ?? "").trim();
  const cap = searching ? 20000 : 2000;

  const range = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T): T => {
    let out = q;
    if (from) out = out.gte("created_at", from);
    if (to) out = out.lte("created_at", to);
    return out;
  };

  const [subs, books, gifts] = await Promise.all([
    range(svc.from("orders")
      .select("id, order_no, invoice_no, invoice_url, receipt_no, amount_inr, status, created_at, razorpay_order_id, razorpay_payment_id, zoho_status, zoho_invoice_id, kind, subjects:subject_id(title), profiles:student_id(full_name, business_name, email, phone, gstin, state)")
      .order("created_at", { ascending: false }).limit(cap) as never) as never,
    range(svc.from("book_orders")
      .select("id, order_no, invoice_no, invoice_url, receipt_no, amount_inr, status, created_at, razorpay_order_id, razorpay_payment_id, zoho_status, zoho_invoice_id, guest_contact, ship_to, items")
      .order("created_at", { ascending: false }).limit(cap) as never) as never,
    range(svc.from("gift_orders")
      .select("id, order_no, invoice_no, invoice_url, receipt_no, amount_inr, taxable_value, cgst, sgst, igst, status, created_at, razorpay_order_id, razorpay_payment_id, billing_name, billing_gstin, billing_state, recipient_name, recipient_email, recipient_phone, months, tier, subjects:subject_id(title)")
      .order("created_at", { ascending: false }).limit(cap) as never) as never,
  ]) as unknown as { data: Record<string, never>[] | null }[];

  const out: AccountRow[] = [];
  const str = (v: unknown) => String(v ?? "");
  const num = (v: unknown) => Number(v) || 0;

  for (const r of subs.data ?? []) {
    const p = r.profiles as unknown as Record<string, string | null> | null;
    out.push({
      table: "orders", id: str(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "",
      invoiceNo: str(r.invoice_no), invoiceUrl: str(r.invoice_url), receiptNo: r.receipt_no ? String(r.receipt_no) : "",
      date: str(r.created_at),
      customer: str(p?.business_name || p?.full_name), email: str(p?.email), phone: str(p?.phone),
      gstin: str(p?.gstin), state: str(p?.state),
      description: str((r.subjects as unknown as { title?: string } | null)?.title) || "Subscription",
      total: num(r.amount_inr), taxable: 0, cgst: 0, sgst: 0, igst: 0,
      status: str(r.status),
      razorpayOrderId: str(r.razorpay_order_id), razorpayPaymentId: str(r.razorpay_payment_id),
      zohoStatus: str(r.zoho_status), zohoInvoiceId: str(r.zoho_invoice_id),
      // An extension is booked separately from a first sale, the way the
      // office has always kept them.
      account: str(r.kind) === "extension" ? "Sales-Validity" : "Sales-Classes",
      hsn: "999293",
    });
  }

  for (const r of books.data ?? []) {
    const s = (r.ship_to ?? {}) as Record<string, string | undefined>;
    const g = (r.guest_contact ?? {}) as Record<string, string | undefined>;
    out.push({
      table: "book_orders", id: str(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "",
      invoiceNo: str(r.invoice_no), invoiceUrl: str(r.invoice_url), receiptNo: r.receipt_no ? String(r.receipt_no) : "",
      date: str(r.created_at),
      customer: str(s.name || g.name), email: str(s.email || g.email), phone: str(s.phone || g.phone),
      gstin: "", state: str(s.state),
      description: `Printed books × ${((r.items ?? []) as unknown as unknown[]).length} line(s)`,
      total: num(r.amount_inr), taxable: 0, cgst: 0, sgst: 0, igst: 0,
      status: str(r.status),
      razorpayOrderId: str(r.razorpay_order_id), razorpayPaymentId: str(r.razorpay_payment_id),
      zohoStatus: str(r.zoho_status), zohoInvoiceId: str(r.zoho_invoice_id),
      // Books are GOODS, not a service — a different ledger and a different
      // HSN, and booking them to the coaching account would misstate both.
      account: "Sales-Books", hsn: "4901",
    });
  }

  for (const r of gifts.data ?? []) {
    out.push({
      table: "gift_orders", id: str(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "",
      invoiceNo: str(r.invoice_no), invoiceUrl: str(r.invoice_url), receiptNo: r.receipt_no ? String(r.receipt_no) : "",
      date: str(r.created_at),
      customer: str(r.billing_name || r.recipient_name), email: str(r.recipient_email), phone: str(r.recipient_phone),
      gstin: str(r.billing_gstin), state: str(r.billing_state),
      // NEVER THE WORD "GIFT" ON A BOOKS DOCUMENT — his instruction. The line
      // names what was sold and whom it serves: "Classes for <student>".
      description: `${str((r.subjects as unknown as { title?: string } | null)?.title) || "Subject"} — ${str(r.tier) || "Gold"} (${str(r.months)} months) — Classes for ${str(r.recipient_name) || "student"}`,
      // A vendor sale is the only one that already stores its own tax split,
      // worked out at the moment of sale. Where it exists it is used rather
      // than recomputed, so the report agrees with the invoice that was issued.
      total: num(r.amount_inr), taxable: num(r.taxable_value),
      cgst: num(r.cgst), sgst: num(r.sgst), igst: num(r.igst),
      status: str(r.status),
      razorpayOrderId: str(r.razorpay_order_id), razorpayPaymentId: str(r.razorpay_payment_id),
      zohoStatus: "", zohoInvoiceId: "",
      account: "Sales-Classes", hsn: "999293",
    });
  }

  // Free-text search across the four handles the accounts team looks a sale up
  // by: order number, invoice number, email and phone. Case-insensitive; the
  // order number matches with or without its leading "#"; the phone matches on
  // digits alone so "+91", spaces or dashes never get in the way.
  const q = (f.q ?? "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const matchesQuery = (r: AccountRow): boolean => {
    if (!q) return true;
    if (r.invoiceNo.toLowerCase().includes(q)) return true;
    if (r.email.toLowerCase().includes(q)) return true;
    if (r.orderNo.toLowerCase().includes(q)) return true;
    if (r.orderNo.replace(/^#/, "").toLowerCase().includes(q)) return true;
    if (qDigits.length >= 4 && r.phone.replace(/\D/g, "").includes(qDigits)) return true;
    return false;
  };

  const filtered = out.filter((r) => matchesState(r.status, f.state ?? ""))
    .filter((r) => !f.zoho || (r.zohoStatus || "none") === f.zoho)
    .filter(matchesQuery);
  filtered.sort((a, b) => b.date.localeCompare(a.date));
  return filtered;
}

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

/** Zoho reads dates as DD/MM/YYYY, and reads an ISO date as the wrong day. */
const dmy = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
  return ist.replace(/-/g, "/");
};

/** "1,000.00" — Zoho's own amount formatting, thousands separator and all. */
const money = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-IN", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** The financial year a date falls in, as Zoho writes a payment prefix. */
function fyPrefix(iso: string): string {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = m >= 3 ? y : y - 1;
  return `E-${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}/`;
}

// The standing wording on every invoice raised through Zoho. Kept here so the
// exported file carries exactly what the manual one did; changing it is a
// business decision, not a formatting one.
const TERMS =
  "(i) Classes and contents against this invoice will be provided by Faculty named above. Aldine CA has no role " +
  "what so ever in providing content/classes. In case of any dispute on providing such content/classes student " +
  "should directly contact respective Faculty.(ii) No refund allowed/permitted against this order since it is a " +
  "digital content.(iii) We are serving student named in above invoice. If buyer of content is not a student, then " +
  "such buyer should issue invoice to student served by us.";

/**
 * EXPORT INVOICES — matching the file Zoho already accepts.
 *
 * The columns, their order and their vocabulary are taken from the export the
 * office has been producing by hand, so this drops into the same import screen
 * without a mapping step. Three things in it are easy to get wrong and are
 * worth naming:
 *
 *   · the date is DD/MM/YYYY — an ISO date imports as the wrong day;
 *   · Place of Supply is Zoho's two-letter code, "DL", not "Delhi" or "07";
 *   · Item Price is the GROSS amount and Is Inclusive Tax is TRUE, so Zoho
 *     works the tax out of it. Sending the taxable value here would overcharge
 *     the customer by 18% in the books.
 */
export function invoicesCsv(rows: AccountRow[]): string {
  const head = [
    "Invoice Number", "Invoice Date", "Customer Name", "GST Treatment",
    "GST Identification Number (GSTIN)", "Place of Supply", "PurchaseOrder", "Account",
    "Item Name", "Item Desc", "Item Type", "HSN/SAC", "Quantity", "Item Price",
    "Is Inclusive Tax", "Item Tax", "Item Tax Type", "Item Tax %", "Supply Type",
    "Discount Type", "Is Discount Before Tax", "Discount Amount", "Template Name",
    "Notes", "Terms & Conditions", "Reference Number", "Name", "Email", "Phone",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    if (!r.invoiceNo) continue;   // no document raised, nothing to import
    lines.push([
      esc(r.invoiceNo), esc(dmy(r.date)), esc(r.customer),
      esc(r.gstin ? "business_gst" : "consumer"), esc(r.gstin), esc(zohoStateCode(r.state)),
      esc(r.orderNo.replace(/^#/, "")), esc(r.account),
      esc(r.description), esc(""), esc("Service"), esc(r.hsn), esc(1), esc(r.total),
      // THE TAX COLUMNS FOLLOW THE PLACE OF SUPPLY. Delhi is intra-state, so
      // CGST+SGST under Zoho's "GST18" group; anywhere else is inter-state,
      // IGST18 as a plain item amount. The strings are Zoho's own vocabulary,
      // copied letter-for-letter from the file their import accepts: "Tax
      // Group" carries one space, "ItemAmount" carries none — get either wrong
      // and every non-Delhi invoice imports with Delhi's tax split.
      esc("TRUE"),
      esc(zohoStateCode(r.state) === "DL" ? "GST18" : "IGST18"),
      esc(zohoStateCode(r.state) === "DL" ? "Tax Group" : "ItemAmount"),
      esc(18), esc("Taxable"),
      esc("item_level"), esc(""), esc(""), esc("Spreadsheet Template"),
      esc("Thanks for your business."), esc(TERMS),
      esc(r.razorpayPaymentId), esc(r.customer), esc(r.email), esc(r.phone),
    ].join(","));
  }
  return "\ufeff" + lines.join("\r\n");
}

/**
 * EXPORT PAYMENTS — the money received, in Zoho's payment shape.
 *
 * Only sales where money actually arrived. Importing a created-but-abandoned
 * checkout would put a receipt in the books against somebody who never paid,
 * and then the bank reconciliation never closes.
 *
 * The payment number is Zoho's own running series (E-26-27/000001), which is a
 * different thing again from our invoice number, our order number and our
 * receipt number — it belongs to the books, not to us.
 */
export function paymentsCsv(rows: AccountRow[], startFrom = 1): string {
  const head = [
    "Payment Number Prefix", "Payment Number Suffix", "Customer Name", "Place of Supply",
    "GST Treatment", "GST Identification Number (GSTIN)", "Payment Type",
    "Description of Supply", "Date", "Mode", "Amount", "Description", "Bank Charges",
    "Tax Account", "Deposit To", "Reference Number", "Invoice Number", "Order No",
    "Amount Applied to Invoice", "Invoice Amount",
  ];
  const lines = [head.join(",")];
  // Oldest first, so the running number climbs with the calendar the way a
  // payment series is expected to.
  const paid = rows.filter((r) => matchesState(r.status, "paid"))
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  let n = Math.max(1, Math.floor(startFrom));
  for (const r of paid) {
    // THE PAYMENT NUMBER IS THE RECEIPT NUMBER. The office matches a payment to
    // its paper trail by the receipt printed on the invoice, so the suffix
    // carries that (a plain integer like 20014). The running counter remains
    // only as a fallback for a paid sale that somehow has no receipt — a blank
    // suffix would make Zoho reject the whole import.
    lines.push([
      esc(fyPrefix(r.date)), esc(r.receiptNo || String(n).padStart(6, "0")), esc(r.customer),
      esc(zohoStateCode(r.state)), esc(r.gstin ? "business_gst" : "consumer"), esc(r.gstin),
      esc("Invoice Payment"), esc(r.description), esc(dmy(r.date)), esc("Razorpay"),
      esc(money(r.total)), esc(""), esc(""), esc(""), esc("Razorpay Clearing"),
      esc(r.razorpayPaymentId), esc(r.invoiceNo), esc(r.orderNo.replace(/^#/, "")),
      esc(money(r.total)), esc(money(r.total)),
    ].join(","));
    n++;
  }
  return "\ufeff" + lines.join("\r\n");
}
