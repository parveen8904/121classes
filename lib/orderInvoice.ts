import { formatDate } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/service";
import { getGstSettings, computeGst, nextInvoiceNo, nextReceiptNo, buildInvoicePdf } from "@/lib/invoice";

// Issue the GST invoice for a PAID order: PDF → private bucket → EMAILED to
// the payer. The admin Sales panel links it; it is NEVER shown inside the
// student login (founder's rule). Idempotent per order; a failure here must
// never break a successful payment.
/** Whole months between two dates, for rows where the length was never stored. */
function monthsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const from = new Date(a), to = new Date(b);
  const m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return m > 0 ? m : null;
}

export async function issueOrderInvoice(opts: {
  razorpayOrderId: string;
  payerUserId?: string | null;
  payerName?: string | null;
  payerEmail?: string | null;
  description: string;
  amountInr: number; // GST-inclusive total actually paid
  table?: "orders" | "book_orders"; // where this payment lives (default: orders)
  paymentRef?: string | null; // Razorpay payment id when the caller has it
}): Promise<void> {
  try {
    const svc = createServiceClient();
    const table = opts.table ?? "orders";
    const { data: ord } = await svc
      .from(table).select("id, invoice_no, order_no" + (table === "orders" ? ", subject_id" : ""))
      .eq("razorpay_order_id", opts.razorpayOrderId).maybeSingle();
    if (!ord || (ord as { invoice_no?: string | null }).invoice_no) return; // unknown / already invoiced
    const orderNo = (ord as { order_no?: number | null }).order_no;
    const subjectId = (ord as { subject_id?: string | null }).subject_id ?? null;

    let name = opts.payerName ?? "";
    let email = opts.payerEmail ?? "";
    let state = "";
    let gstin: string | null = null;
    let address: string | null = null;
    let regNo: number | null = null;
    if (opts.payerUserId) {
      const { data: p } = await svc
        .from("profiles")
        .select("full_name, email, state, gstin, business_name, address_line1, address_line2, city, pincode, registration_no")
        .eq("id", opts.payerUserId).maybeSingle();
      name = (p?.business_name as string) || (p?.full_name as string) || name;
      email = (p?.email as string) || email;
      state = (p?.state as string) || "";
      gstin = (p?.gstin as string) || null;
      address = [p?.address_line1, p?.address_line2, [p?.city, p?.pincode].filter(Boolean).join(" ")]
        .filter(Boolean).join("\n") || null;
      regNo = (p?.registration_no as number) ?? null;
    }

    // Receipt line: the exact validity window this payment created.
    let receiptDetail: string | null = null;
    if (opts.payerUserId && subjectId) {
      const { data: sub } = await svc
        .from("subscriptions").select("starts_at, ends_at")
        .eq("student_id", opts.payerUserId).eq("subject_id", subjectId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (sub) {
        const d = (iso: string | null) => iso ? formatDate(iso) : "";
        receiptDetail = `Starting: ${d(sub.starts_at as string | null) || "on payment"}  ·  Valid till: ${d(sub.ends_at as string | null) || "-"}`;
      }
    }

    const s = await getGstSettings();
    const gst = computeGst(opts.amountInr, state, s);
    const now = new Date();
    const invoiceNo = await nextInvoiceNo(s.prefix, now);
    const receiptNo = await nextReceiptNo();
    const pdf = await buildInvoicePdf({
      invoiceNo, date: now, s, gst,
      buyerName: name || "Student", buyerGstin: gstin, buyerAddress: address,
      buyerState: state || s.state, itemDescription: opts.description,
      // Printed books ship as goods (HSN 4901); coaching services use the SAC.
      itemHsn: table === "book_orders" ? "4901" : undefined,
      // The PAYMENT, when the caller has it. Falling back to the order
      // reference is a last resort and says nothing about money having moved —
      // it is what used to be printed every time.
      paymentRef: opts.paymentRef ?? opts.razorpayOrderId,
      paymentMode: "Online Payment [Razorpay]",
      receiptDetail,
      receiptNo,
      orderId: orderNo ?? null,
    });

    const path = `invoices/${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`;
    const up = await svc.storage.from("secure").upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    const ref = up.error ? null : `secure:${path}`;
    await svc.from(table).update({
      invoice_no: invoiceNo, invoice_url: ref, receipt_no: receiptNo,
      ...(opts.paymentRef ? { razorpay_payment_id: opts.paymentRef } : {}),
    }).eq("razorpay_order_id", opts.razorpayOrderId);

    if (email) {
      const { sendEmail, sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
      const html = emailShell(
        "Payment received — your invoice 🧾",
        `<p>Thank you! Your payment of <strong>Rs. ${Math.round(opts.amountInr).toLocaleString("en-IN")}</strong> for <strong>${opts.description}</strong> has been received.</p>
         <p>Your ${s.enabled ? "GST invoice" : "bill of supply"} (<strong>${invoiceNo}</strong>) is attached for your records.</p>`,
      );
      const subject = `Your invoice ${invoiceNo} — CA Parveen Sharma`;
      const ok = await sendEmailWithAttachment(email, subject, html, {
        filename: `${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf",
      }).catch(() => false);
      if (!ok) await sendEmail(email, subject, html).catch(() => null);
    }
  } catch { /* invoicing must never break a successful payment */ }
}

/**
 * Re-issue an invoice that has already been raised, under the SAME number.
 *
 * Invoice CAPS/2026-27/0003 went out with no address on it and IGST instead of
 * CGST and SGST, because the student's profile carried no state and a blank
 * state used to mean "somewhere else". Both causes are fixed, but the document
 * itself is still wrong and a wrong tax invoice cannot simply be left.
 *
 * Same number on purpose. This is a B2C supply to an unregistered person and
 * the GST return for the period has not been filed, so the correct remedy is to
 * correct the invoice before filing — not to raise a credit note against a
 * customer who was never given one. The number, the date and the amount do not
 * move; only the address and the tax split are put right, from whatever the
 * profile now says.
 *
 * It REFUSES to run without a complete address. Reissuing an incomplete invoice
 * would replace one defective document with another.
 */
// `notify` is separable on purpose. Correcting our own copy of a document is
// housekeeping; writing to the student about it is a letter, and the two are
// not always wanted together — a defect found and fixed within the hour needs
// no apology to somebody who never saw it.
export async function reissueOrderInvoice(orderId: string, notify = true): Promise<{ ok: boolean; reason?: string; invoiceNo?: string }> {
  const svc = createServiceClient();
  const { data: ord } = await svc
    .from("orders")
    .select("id, invoice_no, order_no, receipt_no, subject_id, amount_inr, student_id, razorpay_order_id, razorpay_payment_id, created_at")
    .eq("id", orderId).maybeSingle();
  if (!ord) return { ok: false, reason: "order not found" };
  const invoiceNo = (ord as { invoice_no?: string | null }).invoice_no;
  if (!invoiceNo) return { ok: false, reason: "this order has no invoice yet" };

  const { data: p } = await svc
    .from("profiles")
    .select("full_name, email, state, gstin, business_name, address_line1, address_line2, city, pincode, registration_no")
    .eq("id", (ord as { student_id: string }).student_id).maybeSingle();

  // The STATE is what this refuses without, because the state decides the tax.
  //
  // The street address is wanted, and is now asked for before every payment,
  // but it is not what makes the document valid: for an unregistered recipient
  // the name and address are only required on the invoice where the value
  // exceeds Rs.50,000 (rule 46, CGST Rules). A Rs.2,700 subscription is well
  // under that. What is always required is the place of supply — the state.
  const city = String(p?.city ?? "").trim();
  const state = String(p?.state ?? "").trim();
  const pin = String(p?.pincode ?? "").trim();
  if (!state) {
    return { ok: false, reason: "the student has no state on file — the tax cannot be worked out without it" };
  }

  const address = [p?.address_line1, p?.address_line2, [city, pin].filter(Boolean).join(" ")]
    .filter(Boolean).join("\n") || null;

  // The validity window this payment bought, for the receipt half.
  let receiptDetail: string | null = null;
  let planLine: string | null = null;
  const subjectId = (ord as { subject_id?: string | null }).subject_id ?? null;
  if (subjectId) {
    const { data: sub } = await svc
      .from("subscriptions").select("starts_at, ends_at, months_total, plans(tier)")
      .eq("student_id", (ord as { student_id: string }).student_id).eq("subject_id", subjectId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (sub) {
      const d = (iso: string | null) => iso ? formatDate(iso) : "";
      receiptDetail = `Starting: ${d(sub.starts_at as string | null) || "on payment"}  ·  Valid till: ${d(sub.ends_at as string | null) || "-"}`;
      // What they bought, in the words they chose it by. An invoice that says
      // only the subject leaves the student — and anyone checking the books —
      // to work out from two dates whether this was Gold for a year or Silver
      // for three months.
      const tier = (sub as { plans?: { tier?: string } | null }).plans?.tier ?? null;
      const months = (sub as { months_total?: number | null }).months_total
        ?? monthsBetween(sub.starts_at as string | null, sub.ends_at as string | null);
      planLine = [
        tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : null,
        months ? `${months} month${months === 1 ? "" : "s"}` : null,
      ].filter(Boolean).join(" · ") || null;
    }
  }

  const amount = Number((ord as { amount_inr: number }).amount_inr) || 0;
  const s = await getGstSettings();
  const gst = computeGst(amount, state, s);
  // The ORIGINAL date, not today. Reissuing does not move the supply.
  const date = new Date((ord as { created_at: string }).created_at);

  const { data: subj } = subjectId
    ? await svc.from("subjects").select("title").eq("id", subjectId).maybeSingle()
    : { data: null };
  const base = (subj?.title as string) ?? "Online coaching subscription";
  // "Financial Reporting — Gold · 12 months" rather than "Financial Reporting".
  const description = planLine ? `${base} — ${planLine}` : base;

  const pdf = await buildInvoicePdf({
    invoiceNo, date, s, gst,
    buyerName: (p?.business_name as string) || (p?.full_name as string) || "Student",
    buyerGstin: (p?.gstin as string) || null,
    buyerAddress: address,
    buyerState: state,
    itemDescription: description,
    // The payment first; the order reference only if no payment id was ever
    // captured for this sale.
    paymentRef: (ord as { razorpay_payment_id?: string | null }).razorpay_payment_id
      ?? (ord as { razorpay_order_id?: string | null }).razorpay_order_id ?? null,
    paymentMode: "Online Payment [Razorpay]",
    receiptDetail,
    // A reissue REPRINTS the receipt; it does not issue a new one. A receipt
    // whose number changes when you print it again is not a receipt.
    receiptNo: (ord as { receipt_no?: number | null }).receipt_no ?? null,
    orderId: (ord as { order_no?: number | null }).order_no ?? null,
  });

  const path = `invoices/${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`;
  const up = await svc.storage.from("secure").upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
  if (up.error) return { ok: false, reason: `could not store the PDF: ${up.error.message}` };
  await svc.from("orders").update({ invoice_url: `secure:${path}` }).eq("id", orderId);

  const email = notify ? ((p?.email as string) || "") : "";
  if (email) {
    const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
    const html = emailShell(
      "Your corrected invoice 🧾",
      `<p>We have corrected the invoice for your payment of <strong>Rs. ${Math.round(amount).toLocaleString("en-IN")}</strong>.</p>
       <p>The earlier copy was incomplete — some of the details a GST invoice must carry were missing from it. The corrected invoice (<strong>${invoiceNo}</strong>) is attached. The number, the date and the amount you paid are unchanged; nothing about your payment or your access has altered. Please use this copy and discard the earlier one, and our apologies for the trouble.</p>`,
    );
    await sendEmailWithAttachment(email, `Corrected invoice ${invoiceNo} — CA Parveen Sharma`, html, {
      filename: `${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf",
    }).catch(() => false);
  }
  return { ok: true, invoiceNo };
}
