import { createServiceClient } from "@/lib/supabase/service";
import { getGstSettings, computeGst, nextInvoiceNo, buildInvoicePdf } from "@/lib/invoice";

// Issue the GST invoice for a PAID order: PDF → private bucket → EMAILED to
// the payer. The admin Sales panel links it; it is NEVER shown inside the
// student login (founder's rule). Idempotent per order; a failure here must
// never break a successful payment.
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
        const d = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
        receiptDetail = `Starting: ${d(sub.starts_at as string | null) || "on payment"}  ·  Valid till: ${d(sub.ends_at as string | null) || "-"}`;
      }
    }

    const s = await getGstSettings();
    const gst = computeGst(opts.amountInr, state, s);
    const now = new Date();
    const invoiceNo = await nextInvoiceNo(s.prefix, now);
    const pdf = await buildInvoicePdf({
      invoiceNo, date: now, s, gst,
      buyerName: name || "Student", buyerGstin: gstin, buyerAddress: address,
      buyerState: state || s.state, itemDescription: opts.description,
      // Printed books ship as goods (HSN 4901); coaching services use the SAC.
      itemHsn: table === "book_orders" ? "4901" : undefined,
      registrationNo: regNo,
      receiptNo: orderNo != null ? String(orderNo) : null,
      paymentRef: opts.paymentRef ?? opts.razorpayOrderId,
      paymentMode: "Online Payment [Razorpay]",
      receiptDetail,
    });

    const path = `invoices/${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`;
    const up = await svc.storage.from("secure").upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    const ref = up.error ? null : `secure:${path}`;
    await svc.from(table).update({ invoice_no: invoiceNo, invoice_url: ref }).eq("razorpay_order_id", opts.razorpayOrderId);

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
