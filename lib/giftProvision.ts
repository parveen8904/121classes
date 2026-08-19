import { formatDate } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/service";
import { randomUUID } from "node:crypto";
import { sendEmailWithAttachment, emailShell } from "@/lib/notify";
import { getGstSettings, computeGst, nextInvoiceNo, nextReceiptNo, buildInvoicePdf } from "@/lib/invoice";
import { redeemCoupon } from "@/lib/coupons";

const SITE = "https://caparveensharma.com";

// PROVISION A PAID GIFT/VENDOR ORDER — with or without a browser in the loop.
//
// This is the body that used to live only inside verifyGiftPayment, which runs
// in the BUYER'S browser after Razorpay checkout. A vendor whose connection
// dropped in that half-second left a fully paid student unenrolled, an order
// stuck at "created", and nothing anywhere that would ever finish the job —
// there is no Razorpay webhook. Extracted so three callers share it: the
// checkout callback, the admin's manual confirm, and the reconcile sweep that
// walks stuck orders against Razorpay every quarter hour.
//
// Idempotence is the caller's job (skip rows already provisioned); everything
// here is upsert-shaped regardless.
export async function provisionPaidGiftOrder(
  g: Record<string, never>,
  paymentId: string,
  opts: { gifterEmail?: string | null; couponId?: string | null },
): Promise<void> {
  const svc = createServiceClient();

  // Carried out of the grant block so the note to the student can quote them.
  let provisionStarts: Date | null = null;
  let provisionEnds: Date | null = null;

  // 1) Find or create the recipient's account.
  const email = String(g.recipient_email).trim().toLowerCase();
  let recipientId: string | null = null;
  const { data: existing } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing?.id) recipientId = existing.id;
  else {
    const { data: created } = await svc.auth.admin.createUser({
      email, email_confirm: true, password: "Aa1!" + randomUUID(),
      user_metadata: { full_name: g.recipient_name },
    });
    recipientId = created?.user?.id ?? null;
  }
  if (recipientId) {
    await svc.from("profiles").update({
      full_name: g.recipient_name, phone: g.recipient_phone, target_attempt: g.recipient_attempt, email,
    }).eq("id", recipientId);
    // 2) Grant the subscription — from the date it was SOLD FOR, not the date
    //    the money arrived. A supporter selling in July for an October start
    //    would otherwise hand over a subscription three months shorter than
    //    the one the student paid for. A date already past just means "now".
    // The rule lives in lib/planWindow.ts so it can be run and checked without
    // taking money — this handler sits behind a live payment gateway.
    const { planWindow } = await import("@/lib/planWindow");
    const win = planWindow(g.starts_on as string | null, Number(g.months) || 12);

    // Bronze covers the gap when the paid plan starts later, so the student can
    // sign in the same day instead of meeting an account that shows them
    // nothing until their date.
    if (win.bridge) {
      const { data: bronze } = await svc.from("plans").select("id").eq("tier", "bronze").maybeSingle();
      if (bronze?.id) {
        await svc.from("subscriptions").insert({
          student_id: recipientId, course_id: g.course_id, subject_id: g.subject_id, plan_id: bronze.id,
          channel: "gift", starts_at: win.bridge.startsAt.toISOString(), ends_at: win.bridge.endsAt.toISOString(),
          status: "active", auto_renew: false,
        });
      }
    }

    await svc.from("subscriptions").insert({
      student_id: recipientId, course_id: g.course_id, subject_id: g.subject_id, plan_id: g.plan_id,
      channel: "gift", starts_at: win.paid.startsAt.toISOString(), ends_at: win.paid.endsAt.toISOString(),
      status: "active", auto_renew: false,
    });
    provisionStarts = win.paid.startsAt; provisionEnds = win.paid.endsAt;
    await svc.from("my_courses").upsert({ student_id: recipientId, course_id: g.course_id }, { onConflict: "student_id,course_id" });
    if (g.subject_id) await svc.from("my_subjects").upsert({ student_id: recipientId, subject_id: g.subject_id }, { onConflict: "student_id,subject_id" });
  }

  // 3) GST invoice → PDF → private bucket → email the GIFTER (never the recipient).
  const s = await getGstSettings();
  const gst = computeGst(Number(g.amount_inr), String(g.billing_state), s);
  const now = new Date();
  const invoiceNo = await nextInvoiceNo(s.prefix, now);
  const { data: subj } = await svc.from("subjects").select("title").eq("id", g.subject_id).maybeSingle();
  // "Classes for <student>", never "gift" — his instruction, 19 Aug. The person
  // paying may be an employer or a relative; the invoice should read as tuition
  // for the named student, not as a present.
  const desc = `${subj?.title ?? "Subject"} — ${g.tier} (${g.months} months) — Classes for ${g.recipient_name}`;
  let invoiceRef: string | null = null;
  // Reserved outside the try so the row can record it: a receipt number that is
  // printed but not stored cannot be reprinted, and a reissue would burn a new
  // one — two pieces of paper for one payment.
  const receiptNo = await nextReceiptNo();
  try {
    const pdf = await buildInvoicePdf({
      invoiceNo, date: now, s, gst,
      buyerName: g.billing_name || g.recipient_name, buyerGstin: g.billing_gstin, buyerAddress: g.billing_address, buyerState: String(g.billing_state),
      itemDescription: desc,
      paymentRef: paymentId,
      paymentMode: "Online Payment [Razorpay]",
      receiptDetail: `Classes for ${g.recipient_name} · ${g.months} months`,
      receiptNo,
      orderId: (g as { order_no?: number | null }).order_no ?? null,
    });
    const path = `invoices/${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`;
    const up = await svc.storage.from("secure").upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    if (!up.error) invoiceRef = `secure:${path}`;
    const gifterEmail = opts.gifterEmail || "";
    if (gifterEmail) {
      // A gifter's email always carries the Sponsor Guide alongside the invoice.
      const { buildSponsorGuidePdf } = await import("@/lib/sponsorGuide");
      const guidePdf = await buildSponsorGuidePdf().catch(() => null);
      await sendEmailWithAttachment(
        gifterEmail,
        `Your invoice ${invoiceNo} — CA Parveen Sharma`,
        emailShell("Thank you for your gift 🎁",
          `<p>Your payment was successful and <strong>${g.recipient_name}</strong> now has ${g.tier} access to <strong>${subj?.title ?? "the subject"}</strong> for ${g.months} months.</p>
           <p>Your GST invoice (${invoiceNo}) is attached. Total paid: <strong>Rs. ${Number(gst.total).toLocaleString("en-IN")}</strong>.</p>
           <p>We&apos;ve also attached the <strong>Sponsor Guide</strong> — it explains everything the student receives and how you can sponsor more students. 💚</p>`),
        [
          { filename: `Invoice-${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" },
          ...(guidePdf ? [{ filename: "Sponsor-a-Student-Guide.pdf", content: Buffer.from(guidePdf), contentType: "application/pdf" }] : []),
        ],
      );
    }
  } catch { /* invoice best-effort; payment already captured */ }

  // 4) Plain gift note to the RECIPIENT (no amount, no invoice) + how to log in.
  try {
    const { data: link } = await svc.auth.admin.generateLink({ type: "recovery", email });
    const th = link?.properties?.hashed_token;
    const setUrl = th ? `${SITE}/auth/confirm?token_hash=${th}&type=recovery&next=/auth/reset-password` : `${SITE}/login`;
    const { sendTemplate } = await import("@/lib/emailTemplates");
    // WHO supported them, and the two dates that matter. Never the amount and
    // never the invoice — that is between the supporter and us, and a student
    // who knows what was paid for them is put in an awkward position.
    const { data: supporter } = await svc.from("profiles")
      .select("full_name, business_name").eq("id", g.gifter_id).maybeSingle();
    const supporterName =
      (supporter?.business_name as string) || (supporter?.full_name as string) || "a supporter";
    const d = (x: Date | null) =>
      x ? formatDate(x) : "";
    const from = d(provisionStarts), to = d(provisionEnds);

    await sendTemplate("gift_received", email, {
      heading: "You have been supported 🎓",
      name: g.recipient_name,
      tier: g.tier,
      course: subj?.title ?? "a CA subject",
      months: g.months,
      email,
      supporter: supporterName,
      starts_on: from,
      ends_on: to,
      body_note:
        `<p><strong>${supporterName}</strong> has arranged your ${subj?.title ?? "course"} subscription.</p>` +
        (from ? `<p>It runs from <strong>${from}</strong> to <strong>${to}</strong>.</p>` : "") +
        `<p>You can sign in straight away and look round — the demo classes are open to you now, and your full access opens on the date above.</p>`,
      action_url: setUrl,
      action_label: "Set my password & log in",
    });
  } catch { /* best-effort */ }

  await svc.from("gift_orders").update({
    status: "provisioned", recipient_user_id: recipientId, invoice_no: invoiceNo, invoice_url: invoiceRef, receipt_no: receiptNo,
    razorpay_payment_id: paymentId, taxable_value: gst.taxable, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst,
    paid_at: now.toISOString(),
  }).eq("id", g.id);

  if (opts.couponId) await redeemCoupon(opts.couponId);
}
