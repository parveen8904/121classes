"use server";

import { createClient } from "@/lib/supabase/server";
import {
  razorpayConfigured,
  createRazorpayOrder,
  fetchRazorpayOrder,
  verifyRazorpaySignature,
} from "@/lib/razorpay";
import { createServiceClient } from "@/lib/supabase/service";
import { computePrice } from "@/lib/pricing";
import { notifyByEmail, emailShell } from "@/lib/notify";
import { applyCoupon, redeemCoupon } from "@/lib/coupons";

const TIERS = ["bronze", "silver", "gold"];

export type CreateOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name?: string; email?: string; contact?: string } }
  | { ok: false; reason: "unconfigured" | "auth" | "noplan" | "error" };

export async function createPlanOrder(input: {
  courseId: string;
  tier: string;
  months: number;
  couponCode?: string;
}): Promise<CreateOrderResult> {
  if (!razorpayConfigured()) return { ok: false, reason: "unconfigured" };
  if (!TIERS.includes(input.tier)) return { ok: false, reason: "error" };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };

  const { data: plan } = await supabase
    .from("plans")
    .select("id, name, web_price_inr")
    .eq("tier", input.tier)
    .eq("is_active", true)
    .order("rank")
    .limit(1)
    .maybeSingle();
  if (!plan) return { ok: false, reason: "noplan" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", user.id)
    .single();

    const baseAmount = computePrice(plan.web_price_inr, input.months);
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
      courseId: input.courseId,
      tier: input.tier,
      months: String(input.months),
      planId: plan.id,
      userId: user.id,
      couponId,
    });
    // Record the order attempt.
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
      name: "1:1 CA Classes",
      description: `${plan.name} plan · ${input.months} month${input.months === 1 ? "" : "s"}`,
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

  const months = Number(n.months) || 1;
  const ends = new Date();
  ends.setMonth(ends.getMonth() + months);

  // Service client: students have no INSERT policy on subscriptions; this is a
  // trusted server action running only after a verified payment.
  const svc = createServiceClient();
  await svc.from("subscriptions").insert({
    student_id: user.id,
    course_id: n.courseId,
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

  const { data: course } = await supabase.from("courses").select("title").eq("id", n.courseId).maybeSingle();
  await notifyByEmail({
    studentId: user.id,
    email: user.email ?? null,
    subject: `✅ Payment received — ${course?.title ?? "your course"}`,
    html: emailShell(
      "Payment successful 🎉",
      `<p>Thank you! Your <strong>${n.tier}</strong> access to <strong>${course?.title ?? "your course"}</strong> is now active for ${months} month${months === 1 ? "" : "s"}.</p>
       <p>Jump back in and keep learning. 📚💪</p>`,
    ),
    template: "plan_purchased",
    payload: { courseId: n.courseId, tier: n.tier, months },
  });

  return { ok: true, courseId: n.courseId };
}
