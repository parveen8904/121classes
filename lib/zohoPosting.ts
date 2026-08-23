import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { zohoStateCode } from "@/lib/indiaStates";

// THE POSTING ENGINE — portal sales → Zoho Books, in the team's own house style.
//
// Learned from their FY26-27 entries (23 Aug 2026) and preserved exactly:
//   invoice: CAPS series = the PORTAL's own invoice number, reference = order
//   no, line booked to Sales-Classes (Sales-Validity for extensions), SAC
//   999293, inclusive tax, GST18 intra-Delhi / IGST18 inter, the standing
//   terms text; payment: mode Razorpay into "Razorpay Clearing", reference =
//   pay_… id, description = order no, number = the portal's E-series receipt.
//
// RULES OF THE DESK: nothing posts without an approval tick; anything already
// in Zoho (matched by reference number) is linked and left alone — the team
// may always post manually and the engine steps aside.

const SELLER_STATE_CODE = "DL"; // the org's GST registration is Delhi

// The standing wording on every invoice — the team's own text, verbatim.
const TERMS =
  "(i) Classes and contents against this invoice will be provided by Faculty named above. Aldine CA has no role " +
  "what so ever in providing content/classes. In case of any dispute on providing such content/classes student " +
  "should directly contact respective Faculty.(ii) No refund allowed/permitted against this order since it is a " +
  "digital content.(iii) We are serving student named in above invoice. If buyer of content is not a student, then " +
  "such buyer should issue invoice to student served by us.";

// ---- Zoho reference lookups (by NAME, cached — ids must never be guessed) ---

let refCache: { salesClasses: string; salesValidity: string; clearing: string; gst18: string; igst18: string } | null = null;

async function accountIdByName(name: string): Promise<string> {
  const r = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string }[] }>(
    "/chartofaccounts", { query: { search_text: name, filter_by: "AccountType.All" } });
  const hit = (r.chartofaccounts ?? []).find((a) => a.account_name === name);
  if (!hit) throw new Error(`Zoho account "${name}" not found`);
  return hit.account_id;
}

async function refs() {
  if (refCache) return refCache;
  const taxes = await zohoFetch<{ taxes?: { tax_id: string; tax_name: string }[] }>("/settings/taxes");
  const tax = (n: string) => {
    const t = (taxes.taxes ?? []).find((x) => x.tax_name === n);
    if (!t) throw new Error(`Zoho tax "${n}" not found`);
    return t.tax_id;
  };
  refCache = {
    salesClasses: await accountIdByName("Sales-Classes"),
    salesValidity: await accountIdByName("Sales-Validity"),
    clearing: await accountIdByName("Razorpay Clearing"),
    gst18: tax("GST18"),
    igst18: tax("IGST18"),
  };
  return refCache;
}

// ---- The proposal payload ----------------------------------------------------

export type SalePayload = {
  orderNo: number;
  customer: string;
  email: string;
  stateCode: string;      // Zoho place-of-supply code; "" = unknown → needs_info
  gstin: string;
  description: string;
  amountInr: number;      // gross, tax-inclusive
  date: string;           // YYYY-MM-DD (IST)
  invoiceNo: string;      // the portal's CAPS number; "" until generated
  receiptNo: string;      // the portal's E-series receipt suffix
  razorpayPaymentId: string;
  extension: boolean;     // true → Sales-Validity
};

const istDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const str = (v: unknown) => String(v ?? "");

/**
 * Scan the three sales tables for paid sales the engine has not seen, and file
 * each as a DRAFT (or link it as MATCHED when Zoho already holds an invoice
 * with that order number — the team's manual entries, honoured forever).
 * Existing drafts get their payload refreshed (e.g. a portal invoice number
 * that has been generated since). Returns a short human summary.
 */
export async function scanPortalSales(): Promise<string> {
  const svc = createServiceClient();

  const [{ data: subs }, { data: books }, { data: gifts }] = await Promise.all([
    svc.from("orders")
      .select("id, order_no, invoice_no, receipt_no, amount_inr, status, created_at, razorpay_payment_id, kind, subjects:subject_id(title), profiles:student_id(full_name, business_name, email, gstin, state)")
      .in("status", ["paid", "provisioned"]).not("order_no", "is", null),
    svc.from("book_orders")
      .select("id, order_no, invoice_no, receipt_no, amount_inr, status, created_at, razorpay_payment_id, guest_contact, ship_to")
      .in("status", ["paid", "dispatched", "delivered"]).not("order_no", "is", null),
    svc.from("gift_orders")
      .select("id, order_no, invoice_no, receipt_no, amount_inr, status, created_at, razorpay_payment_id, billing_name, billing_gstin, billing_state, recipient_name, recipient_email, months, tier, subjects:subject_id(title)")
      .in("status", ["paid", "provisioned"]).not("order_no", "is", null),
  ]);

  type Cand = { table: string; id: string; payload: SalePayload };
  const cands: Cand[] = [];

  for (const r of (subs ?? []) as Record<string, unknown>[]) {
    const p = r.profiles as Record<string, string | null> | null;
    cands.push({
      table: "orders", id: str(r.id),
      payload: {
        orderNo: Number(r.order_no),
        customer: str(p?.business_name || p?.full_name) || "Student",
        email: str(p?.email),
        stateCode: zohoStateCode(str(p?.state)),
        gstin: str(p?.gstin),
        description: str((r.subjects as { title?: string } | null)?.title) || "Subscription",
        amountInr: Number(r.amount_inr) || 0,
        date: istDay(str(r.created_at)),
        invoiceNo: str(r.invoice_no),
        receiptNo: r.receipt_no ? String(r.receipt_no) : "",
        razorpayPaymentId: str(r.razorpay_payment_id),
        extension: str(r.kind) === "extension",
      },
    });
  }
  for (const r of (books ?? []) as Record<string, unknown>[]) {
    const s = (r.ship_to ?? {}) as Record<string, string | undefined>;
    const g = (r.guest_contact ?? {}) as Record<string, string | undefined>;
    cands.push({
      table: "book_orders", id: str(r.id),
      payload: {
        orderNo: Number(r.order_no),
        customer: str(s.name || g.name) || "Customer",
        email: str(s.email || g.email),
        stateCode: zohoStateCode(str(s.state)),
        gstin: "",
        description: "Printed books",
        amountInr: Number(r.amount_inr) || 0,
        date: istDay(str(r.created_at)),
        invoiceNo: str(r.invoice_no),
        receiptNo: r.receipt_no ? String(r.receipt_no) : "",
        razorpayPaymentId: str(r.razorpay_payment_id),
        extension: false,
      },
    });
  }
  for (const r of (gifts ?? []) as Record<string, unknown>[]) {
    cands.push({
      table: "gift_orders", id: str(r.id),
      payload: {
        orderNo: Number(r.order_no),
        customer: str(r.billing_name || r.recipient_name) || "Customer",
        email: str(r.recipient_email),
        stateCode: zohoStateCode(str(r.billing_state)),
        gstin: str(r.billing_gstin),
        description: `${str((r.subjects as { title?: string } | null)?.title) || "Subject"} — ${str(r.tier) || "gold"} (${str(r.months)} months)`,
        amountInr: Number(r.amount_inr) || 0,
        date: istDay(str(r.created_at)),
        invoiceNo: str(r.invoice_no),
        receiptNo: r.receipt_no ? String(r.receipt_no) : "",
        razorpayPaymentId: str(r.razorpay_payment_id),
        extension: false,
      },
    });
  }

  const { data: existing } = await svc.from("zoho_postings").select("source_table, source_id, status");
  const seen = new Map((existing ?? []).map((e) => [`${e.source_table}:${e.source_id}`, e.status as string]));

  let drafts = 0, matched = 0, refreshed = 0;
  for (const c of cands) {
    const key = `${c.table}:${c.id}`;
    const cur = seen.get(key);
    if (cur && cur !== "draft" && cur !== "needs_info") continue;
    if (cur === "draft" || cur === "needs_info") {
      // Refresh the payload (a portal invoice/receipt may have been generated since).
      await svc.from("zoho_postings").update({
        payload: c.payload,
        status: c.payload.stateCode && c.payload.invoiceNo ? "draft" : "needs_info",
        updated_at: new Date().toISOString(),
      }).eq("source_table", c.table).eq("source_id", c.id);
      refreshed++;
      continue;
    }

    // NEW to the engine — is it already in Zoho (the team's manual entry)?
    let zohoInv: { invoice_id?: string; invoice_number?: string } | null = null;
    try {
      const found = await zohoFetch<{ invoices?: { invoice_id: string; invoice_number: string }[] }>(
        "/invoices", { query: { reference_number: String(c.payload.orderNo) } });
      zohoInv = (found.invoices ?? [])[0] ?? null;
    } catch { /* lookup failure → treat as not found; match-don't-duplicate still holds at post time */ }

    if (zohoInv?.invoice_id) {
      await svc.from("zoho_postings").insert({
        source_table: c.table, source_id: c.id, order_no: c.payload.orderNo,
        status: "matched", payload: c.payload,
        zoho_invoice_id: zohoInv.invoice_id, zoho_invoice_number: zohoInv.invoice_number ?? null,
      });
      // AND TELL THE REGISTER. Finding a sale already in Zoho is the answer to
      // "is this in the books" — but it was only ever recorded here, so the
      // orders register went on saying "not in Zoho yet" about sales the team
      // had entered themselves. Two screens, two answers, and the one he reads
      // first was the wrong one.
      await svc.from(c.table).update({
        zoho_status: "posted", zoho_invoice_id: zohoInv.invoice_id,
      }).eq("id", c.id);
      matched++;
    } else {
      await svc.from("zoho_postings").insert({
        source_table: c.table, source_id: c.id, order_no: c.payload.orderNo,
        status: c.payload.stateCode && c.payload.invoiceNo ? "draft" : "needs_info",
        payload: c.payload,
      });
      drafts++;
    }
  }
  return `${drafts} new draft(s), ${matched} matched to the team's entries, ${refreshed} refreshed.`;
}

// ---- Posting one approved sale ----------------------------------------------

async function findOrCreateCustomer(name: string, email: string): Promise<string> {
  const r = await zohoFetch<{ contacts?: { contact_id: string; contact_name: string }[] }>(
    "/contacts", { query: { contact_name: name } });
  const exact = (r.contacts ?? []).find((x) => x.contact_name.trim().toLowerCase() === name.trim().toLowerCase());
  if (exact) return exact.contact_id;
  const made = await zohoFetch<{ contact?: { contact_id: string } }>("/contacts", {
    method: "POST",
    body: { contact_name: name, contact_type: "customer", ...(email ? { email } : {}) },
  });
  if (!made.contact?.contact_id) throw new Error("could not create the customer");
  return made.contact.contact_id;
}

/** Post one approved sale: customer → invoice (portal's own number) → mark sent → payment. Idempotent by reference check. */
export async function postSale(postingId: string): Promise<void> {
  const svc = createServiceClient();
  const { data: row } = await svc.from("zoho_postings").select("*").eq("id", postingId).maybeSingle();
  if (!row) throw new Error("posting not found");
  if (row.status === "posted" || row.status === "matched") return;
  const p = row.payload as SalePayload;
  if (!p.invoiceNo) throw new Error("the portal invoice number is not generated yet");
  if (!p.stateCode) throw new Error("the customer's state is missing — needed for place of supply");

  const fail = async (msg: string) => {
    await svc.from("zoho_postings").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", postingId);
    throw new Error(msg);
  };

  try {
    // MATCH-DON'T-DUPLICATE, re-checked at the moment of posting: if the team
    // entered it manually since the draft was made, link and stop.
    const dup = await zohoFetch<{ invoices?: { invoice_id: string; invoice_number: string }[] }>(
      "/invoices", { query: { reference_number: String(p.orderNo) } });
    const hit = (dup.invoices ?? [])[0];
    if (hit) {
      await svc.from("zoho_postings").update({
        status: "matched", zoho_invoice_id: hit.invoice_id, zoho_invoice_number: hit.invoice_number,
        updated_at: new Date().toISOString(),
      }).eq("id", postingId);
      return;
    }

    const R = await refs();
    const customerId = await findOrCreateCustomer(p.customer, p.email);
    const intra = p.stateCode === SELLER_STATE_CODE;

    const inv = await zohoFetch<{ invoice?: { invoice_id: string; invoice_number: string } }>(
      "/invoices",
      {
        method: "POST",
        query: { ignore_auto_number_generation: "true" },
        body: {
          customer_id: customerId,
          invoice_number: p.invoiceNo,
          reference_number: String(p.orderNo),
          date: p.date,
          due_date: p.date,
          place_of_supply: p.stateCode,
          gst_treatment: p.gstin ? "business_gst" : "consumer",
          ...(p.gstin ? { gst_no: p.gstin } : {}),
          is_inclusive_tax: true,
          line_items: [{
            name: p.description.slice(0, 100),
            rate: p.amountInr,
            quantity: 1,
            hsn_or_sac: "999293",
            account_id: p.extension ? R.salesValidity : R.salesClasses,
            tax_id: intra ? R.gst18 : R.igst18,
          }],
          notes: "Thanks for your business.",
          terms: TERMS,
        },
      });
    if (!inv.invoice?.invoice_id) return fail("Zoho did not return the created invoice");

    // Draft → Sent (a payment cannot apply to a draft invoice).
    await zohoFetch(`/invoices/${inv.invoice.invoice_id}/status/sent`, { method: "POST" });

    // The payment — the portal's E-series receipt number, like the team records it.
    const payBody: Record<string, unknown> = {
      customer_id: customerId,
      payment_mode: "Razorpay",
      amount: p.amountInr,
      date: p.date,
      account_id: R.clearing,
      reference_number: p.razorpayPaymentId || String(p.orderNo),
      description: String(p.orderNo),
      invoices: [{ invoice_id: inv.invoice.invoice_id, amount_applied: p.amountInr }],
      ...(p.receiptNo ? { payment_number: `E-26-27/${p.receiptNo}` } : {}),
    };
    let paymentId = "";
    try {
      const pay = await zohoFetch<{ payment?: { payment_id: string } }>("/customerpayments", { method: "POST", body: payBody });
      paymentId = pay.payment?.payment_id ?? "";
    } catch {
      // Some editions refuse a custom payment number — retry with Zoho's own.
      delete payBody.payment_number;
      const pay = await zohoFetch<{ payment?: { payment_id: string } }>("/customerpayments", { method: "POST", body: payBody });
      paymentId = pay.payment?.payment_id ?? "";
    }

    await svc.from("zoho_postings").update({
      status: "posted",
      zoho_customer_id: customerId,
      zoho_invoice_id: inv.invoice.invoice_id,
      zoho_invoice_number: inv.invoice.invoice_number,
      zoho_payment_id: paymentId || null,
      error: null,
      posted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", postingId);

    // The register must say the same thing as this desk.
    await svc.from(String(row.source_table)).update({
      zoho_status: "posted", zoho_invoice_id: inv.invoice.invoice_id,
    }).eq("id", String(row.source_id));
  } catch (e) {
    if (e instanceof Error && e.message.includes("status")) throw e;
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}
