"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { randomUUID } from "node:crypto";
import {
  razorpayConfigured, razorpayKeyId, createRazorpayOrder, fetchRazorpayOrder, verifyRazorpaySignature,
} from "@/lib/razorpay";
import { sendEmail, sendEmailWithAttachment, emailShell } from "@/lib/notify";
import { getGstSettings, computeGst, nextInvoiceNo, buildInvoicePdf } from "@/lib/invoice";
import { applyCoupon, redeemCoupon } from "@/lib/coupons";

const SITE = "https://caparveensharma.com";
const PAID = ["silver", "gold"];

type GiftInput = {
  subjectId: string; tier: string; months?: number; couponCode?: string;
  recipient: { name: string; email: string; phone?: string; attempt?: string; address?: string };
  billing: { name: string; gstin?: string; address?: string; state: string };
};

export type GiftOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name?: string; email?: string } }
  | { ok: false; reason: string };

// The gifter pays. We price exactly like a normal purchase, then attach all the
// recipient + billing details to the Razorpay order + our gift_orders row.
export async function createGiftOrder(input: GiftInput): Promise<GiftOrderResult> {
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };
  if (input.tier !== "gold") return { ok: false, reason: "error" }; // sponsors gift Gold only
  if (!input.recipient?.email || !input.recipient?.name || !input.billing?.state) return { ok: false, reason: "missing" };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };

  const svc = createServiceClient();
  const { data: subject } = await svc.from("subjects").select("id, title, course_id, gold_price_inr, validity_months").eq("id", input.subjectId).single();
  if (!subject) return { ok: false, reason: "error" };
  const { data: plan } = await svc.from("plans").select("id, name, web_price_inr").eq("tier", input.tier).eq("is_active", true).order("rank").limit(1).maybeSingle();
  if (!plan) return { ok: false, reason: "noplan" };

  const baseMonths = subject.validity_months || 12;
  let months = baseMonths, amount: number | null;
  if (input.tier === "gold") {
    if (!subject.gold_price_inr || subject.gold_price_inr <= 0) return { ok: false, reason: "noprice" };
    months = input.months ? Math.min(60, Math.max(1, Math.round(input.months))) : baseMonths;
    amount = Math.max(1, Math.round((subject.gold_price_inr * months) / baseMonths));
  } else {
    amount = plan.web_price_inr;
    if (!amount || amount <= 0) return { ok: false, reason: "noprice" };
  }

  // Optional coupon (donor-scoped coupons apply here).
  let couponId = "";
  if (input.couponCode) {
    const applied = await applyCoupon(input.couponCode, amount, { kind: "donor", email: user.email });
    if (applied) { amount = applied.amount; couponId = applied.couponId; }
  }

  const s = await getGstSettings();
  const gst = computeGst(amount, input.billing.state, s);

  try {
    const order = await createRazorpayOrder(amount, `gift_${Date.now()}`, {
      kind: "gift", subjectId: subject.id, courseId: subject.course_id, tier: input.tier,
      months: String(months), planId: plan.id, gifterId: user.id, couponId,
    });
    await svc.from("gift_orders").insert({
      gifter_id: user.id,
      recipient_name: input.recipient.name, recipient_email: input.recipient.email.trim().toLowerCase(),
      recipient_phone: input.recipient.phone || null, recipient_attempt: input.recipient.attempt || null,
      recipient_address: input.recipient.address || null,
      course_id: subject.course_id, subject_id: subject.id, plan_id: plan.id, tier: input.tier, months,
      billing_name: input.billing.name || input.recipient.name, billing_gstin: input.billing.gstin || null,
      billing_address: input.billing.address || null, billing_state: input.billing.state,
      amount_inr: amount, taxable_value: gst.taxable, gst_rate: gst.rate, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst,
      razorpay_order_id: order.id, status: "created",
    });
    const { data: prof } = await svc.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
    return {
      ok: true, orderId: order.id, amount: order.amount, keyId: await razorpayKeyId(),
      name: "CA Parveen Sharma", description: `Gift · ${subject.title} · ${plan.name} (${months}m)`,
      prefill: { name: prof?.full_name ?? undefined, email: prof?.email ?? user.email ?? undefined },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function verifyGiftPayment(input: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }): Promise<{ ok: boolean }> {
  if (!(await verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature))) return { ok: false };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  let order;
  try { order = await fetchRazorpayOrder(input.razorpay_order_id); } catch { return { ok: false }; }
  if ((order.notes ?? {}).kind !== "gift" || order.status !== "paid") return { ok: false };

  const svc = createServiceClient();
  const { data: g } = await svc.from("gift_orders").select("*").eq("razorpay_order_id", input.razorpay_order_id).maybeSingle();
  if (!g || g.status === "provisioned") return { ok: !!g }; // idempotent

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
    // 2) Grant the gifted subscription to the recipient.
    const ends = new Date(); ends.setMonth(ends.getMonth() + (Number(g.months) || 12));
    await svc.from("subscriptions").insert({
      student_id: recipientId, course_id: g.course_id, subject_id: g.subject_id, plan_id: g.plan_id,
      channel: "gift", ends_at: ends.toISOString(), status: "active", auto_renew: false,
    });
    await svc.from("my_courses").upsert({ student_id: recipientId, course_id: g.course_id }, { onConflict: "student_id,course_id" });
    if (g.subject_id) await svc.from("my_subjects").upsert({ student_id: recipientId, subject_id: g.subject_id }, { onConflict: "student_id,subject_id" });
  }

  // 3) GST invoice → PDF → private bucket → email the GIFTER (never the recipient).
  const s = await getGstSettings();
  const gst = computeGst(Number(g.amount_inr), String(g.billing_state), s);
  const now = new Date();
  const invoiceNo = await nextInvoiceNo(s.prefix, now);
  const { data: subj } = await svc.from("subjects").select("title").eq("id", g.subject_id).maybeSingle();
  const desc = `${subj?.title ?? "Subject"} — ${g.tier} (${g.months} months) — gift for ${g.recipient_name}`;
  let invoiceRef: string | null = null;
  try {
    const pdf = await buildInvoicePdf({
      invoiceNo, date: now, s, gst,
      buyerName: g.billing_name || g.recipient_name, buyerGstin: g.billing_gstin, buyerAddress: g.billing_address, buyerState: String(g.billing_state),
      itemDescription: desc,
    });
    const path = `invoices/${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`;
    const up = await svc.storage.from("secure").upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    if (!up.error) invoiceRef = `secure:${path}`;
    const gifterEmail = user.email || "";
    if (gifterEmail) {
      await sendEmailWithAttachment(
        gifterEmail,
        `Your invoice ${invoiceNo} — CA Parveen Sharma`,
        emailShell("Thank you for your gift 🎁",
          `<p>Your payment was successful and <strong>${g.recipient_name}</strong> now has ${g.tier} access to <strong>${subj?.title ?? "the subject"}</strong> for ${g.months} months.</p>
           <p>Your GST invoice (${invoiceNo}) is attached. Total paid: <strong>Rs. ${Number(gst.total).toLocaleString("en-IN")}</strong>.</p>`),
        { filename: `Invoice-${invoiceNo.replace(/[^\w-]/g, "_")}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" },
      );
    }
  } catch { /* invoice best-effort; payment already captured */ }

  // 4) Plain gift note to the RECIPIENT (no amount, no invoice) + how to log in.
  try {
    const { data: link } = await svc.auth.admin.generateLink({ type: "recovery", email });
    const th = link?.properties?.hashed_token;
    const setUrl = th ? `${SITE}/auth/confirm?token_hash=${th}&type=recovery&next=/auth/reset-password` : `${SITE}/login`;
    await sendEmail(email, `🎁 You've received a gift subscription — CA Parveen Sharma`,
      emailShell("A gift for you 🎁",
        `<p>Hi ${g.recipient_name},</p>
         <p>Someone has gifted you <strong>${g.tier}</strong> access to <strong>${subj?.title ?? "a CA subject"}</strong> with CA Parveen Sharma for ${g.months} months. 🎉</p>
         <p>Set your password and start learning:</p>
         <p><a href="${setUrl}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Set my password &amp; log in</a></p>
         <p>Your login email is <strong>${email}</strong>.</p>`));
  } catch { /* best-effort */ }

  await svc.from("gift_orders").update({
    status: "provisioned", recipient_user_id: recipientId, invoice_no: invoiceNo, invoice_url: invoiceRef,
    razorpay_payment_id: input.razorpay_payment_id, taxable_value: gst.taxable, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst,
    paid_at: now.toISOString(),
  }).eq("id", g.id);

  const couponId = (order.notes as { couponId?: string })?.couponId;
  if (couponId) await redeemCoupon(couponId);

  return { ok: true };
}
