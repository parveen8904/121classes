"use server";

import { createClient } from "@/lib/supabase/server";
import {
  razorpayConfigured,
  createRazorpayOrder,
  fetchRazorpayOrder,
  verifyRazorpaySignature,
} from "@/lib/razorpay";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyByEmail, emailShell } from "@/lib/notify";
import { applyCoupon, redeemCoupon } from "@/lib/coupons";

const PAID_TIERS = ["silver", "gold"];

export type CreateOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name?: string; email?: string; contact?: string } }
  | { ok: false; reason: "unconfigured" | "auth" | "noplan" | "noprice" | "error" };

export async function createPlanOrder(input: {
  subjectId: string;
  tier: string;
  months?: number;
  couponCode?: string;
}): Promise<CreateOrderResult> {
  if (!razorpayConfigured()) return { ok: false, reason: "unconfigured" };
  if (!PAID_TIERS.includes(input.tier)) return { ok: false, reason: "error" };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };

  const { data: subject } = await supabase
    .from("subjects")
    .select("id, title, course_id, gold_price_inr, validity_months")
    .eq("id", input.subjectId)
    .single();
  if (!subject) return { ok: false, reason: "error" };

  const { data: plan } = await supabase
    .from("plans")
    .select("id, name, web_price_inr")
    .eq("tier", input.tier)
    .eq("is_active", true)
    .order("rank")
    .limit(1)
    .maybeSingle();
  if (!plan) return { ok: false, reason: "noplan" };

  // Silver = a flat price for the subject's standard validity. Gold = the
  // subject's own price, scaled to the validity the student chose.
  const baseMonths = subject.validity_months || 12;
  let months = baseMonths;
  let baseAmount: number | null;
  if (input.tier === "gold") {
    if (!subject.gold_price_inr || subject.gold_price_inr <= 0) return { ok: false, reason: "noprice" };
    months = input.months ? Math.min(60, Math.max(1, Math.round(input.months))) : baseMonths;
    baseAmount = Math.max(1, Math.round((subject.gold_price_inr * months) / baseMonths));
  } else {
    baseAmount = plan.web_price_inr;
    if (!baseAmount || baseAmount <= 0) return { ok: false, reason: "noprice" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", user.id)
    .single();

  let amountInr = baseAmount;
  let couponId = "";
  if (input.couponCode) {
    const applied = await applyCoupon(input.couponCode, baseAmount);
    if (applied) {
      amountInr = applied.amount;
      couponId = applied.couponId;
    }
  }

  try {
    const order = await createRazorpayOrder(amountInr, `plan_${Date.now()}`, {
      kind: "subscription",
      courseId: subject.course_id,
      subjectId: subject.id,
      tier: input.tier,
      months: String(months),
      planId: plan.id,
      userId: user.id,
      couponId,
    });
    await supabase.from("orders").insert({
      student_id: user.id,
      kind: "subscription",
      channel: "web",
      razorpay_order_id: order.id,
      amount_inr: amountInr,
      status: "created",
    });
    return {
      ok: true,
      orderId: order.id,
      amount: order.amount,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID!,
      name: "121 CA Classes",
      description: `${subject.title} · ${plan.name} (${months} months)`,
      prefill: {
        name: profile?.full_name ?? undefined,
        email: profile?.email ?? user.email ?? undefined,
        contact: profile?.phone ?? undefined,
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function verifyPlanPayment(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean; courseId?: string }> {
  if (
    !verifyRazorpaySignature(
      input.razorpay_order_id,
      input.razorpay_payment_id,
      input.razorpay_signature,
    )
  ) {
    return { ok: false };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // Trust Razorpay's stored notes, not the client.
  let order;
  try {
    order = await fetchRazorpayOrder(input.razorpay_order_id);
  } catch {
    return { ok: false };
  }
  const n = order.notes ?? {};
  if (n.kind !== "subscription" || n.userId !== user.id) return { ok: false };
  if (order.status !== "paid") return { ok: false };

  const months = Number(n.months) || 12;
  const ends = new Date();
  ends.setMonth(ends.getMonth() + months);

  // Service client: students have no INSERT policy on subscriptions; this is a
  // trusted server action running only after a verified payment. The grant is
  // per-subject (subject_id) so it unlocks exactly what was bought.
  const svc = createServiceClient();
  await svc.from("subscriptions").insert({
    student_id: user.id,
    course_id: n.courseId,
    subject_id: n.subjectId ?? null,
    plan_id: n.planId,
    channel: "web",
    ends_at: ends.toISOString(),
    status: "active",
    auto_renew: true,
  });
  await svc
    .from("orders")
    .update({ status: "paid", store_txn_id: input.razorpay_payment_id })
    .eq("razorpay_order_id", input.razorpay_order_id);
  if (n.couponId) await redeemCoupon(n.couponId);

  const { data: subject } = await supabase
    .from("subjects")
    .select("title")
    .eq("id", n.subjectId)
    .maybeSingle();
  await notifyByEmail({
    studentId: user.id,
    email: user.email ?? null,
    subject: `✅ Payment received — ${subject?.title ?? "your subject"}`,
    html: emailShell(
      "Payment successful 🎉",
      `<p>Thank you! Your <strong>${n.tier}</strong> access to <strong>${subject?.title ?? "your subject"}</strong> is now active for ${months} month${months === 1 ? "" : "s"}.</p>
       <p>Jump back in and keep learning. 📚💪</p>`,
    ),
    template: "plan_purchased",
    payload: { courseId: n.courseId, subjectId: n.subjectId, tier: n.tier, months },
  });

  return { ok: true, courseId: n.courseId };
}
