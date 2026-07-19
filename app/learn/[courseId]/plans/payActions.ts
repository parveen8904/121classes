"use server";

import { createClient } from "@/lib/supabase/server";
import {
  razorpayConfigured,
  razorpayKeyId,
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
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };
  if (!PAID_TIERS.includes(input.tier)) return { ok: false, reason: "error" };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };

  const { data: subject } = await supabase
    .from("subjects")
    .select("id, title, course_id, gold_price_inr, validity_months, gold_slabs, silver_slabs, batch_months, batch_price_inr")
    .eq("id", input.subjectId)
    .single();
  if (!subject) return { ok: false, reason: "error" };

  // Live-batch subjects sell as ONE fixed-price Gold package — no Silver, no
  // month choice; the student always gets exactly batch_months of access.
  const batchMonths = Number((subject as { batch_months?: number | null }).batch_months) || 0;
  if (batchMonths > 0 && input.tier !== "gold") return { ok: false, reason: "error" };

  const { data: plan } = await supabase
    .from("plans")
    .select("id, name, web_price_inr")
    .eq("tier", input.tier)
    .eq("is_active", true)
    .order("rank")
    .limit(1)
    .maybeSingle();
  if (!plan) return { ok: false, reason: "noplan" };

  // Price = a per-subject slab ladder if set (marginal per-month rates by
  // duration), else the legacy flat/linear pricing. Computed SERVER-SIDE only —
  // never trust a client-sent amount.
  const { parseSlabs, slabTotal } = await import("@/lib/pricing");
  const baseMonths = subject.validity_months || 12;
  const slabs = parseSlabs(input.tier === "gold" ? (subject as { gold_slabs?: unknown }).gold_slabs : (subject as { silver_slabs?: unknown }).silver_slabs);
  let months = baseMonths;
  let baseAmount: number | null;
  if (batchMonths > 0) {
    // Fixed price set by the admin; NULL means not announced yet.
    const price = Number((subject as { batch_price_inr?: number | null }).batch_price_inr) || 0;
    if (price <= 0) return { ok: false, reason: "noprice" };
    months = batchMonths;
    baseAmount = price;
  } else if (slabs) {
    // Slab-priced tiers let the student choose the number of months.
    months = input.months ? Math.min(60, Math.max(1, Math.round(input.months))) : baseMonths;
    baseAmount = slabTotal(slabs, months);
  } else if (input.tier === "gold") {
    if (!subject.gold_price_inr || subject.gold_price_inr <= 0) return { ok: false, reason: "noprice" };
    months = input.months ? Math.min(60, Math.max(1, Math.round(input.months))) : baseMonths;
    baseAmount = Math.max(1, Math.round((subject.gold_price_inr * months) / baseMonths));
  } else {
    baseAmount = plan.web_price_inr;
    if (!baseAmount || baseAmount <= 0) return { ok: false, reason: "noprice" };
  }

  // Live sale: the discount % comes off the computed price before any coupon.
  {
    const { saleFromSettings, applySaleDiscount } = await import("@/lib/sale");
    const { data: settings } = await supabase.from("site_settings").select("key, value");
    const sale = saleFromSettings(new Map((settings ?? []).map((r) => [r.key, r.value as string | null])));
    if (sale && baseAmount != null) baseAmount = applySaleDiscount(baseAmount, sale);
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
      keyId: await razorpayKeyId(),
      name: "CA Parveen Sharma",
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
    !(await verifyRazorpaySignature(
      input.razorpay_order_id,
      input.razorpay_payment_id,
      input.razorpay_signature,
    ))
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
    months_total: months,
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

// ---- Extend an existing subscription ---------------------------------------
// The student keeps everything they have and only pays for the ADDITIONAL
// months, priced at their position on the ladder (slabTotal(new) − slabTotal(now)).
// Capped by the course's max_subscription_months (CA Final 3 yrs / Inter 2 yrs).

export type ExtendOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name?: string; email?: string; contact?: string } }
  | { ok: false; reason: "unconfigured" | "auth" | "nosub" | "atcap" | "noprice" | "error" };

export async function createExtendOrder(input: {
  subjectId: string;
  addMonths: number;
  couponCode?: string;
}): Promise<ExtendOrderResult> {
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };

  const add = Math.min(60, Math.max(1, Math.round(input.addMonths || 0)));
  if (!add) return { ok: false, reason: "error" };

  const { data: subject } = await supabase
    .from("subjects")
    .select("id, title, course_id, gold_price_inr, validity_months, gold_slabs, batch_months")
    .eq("id", input.subjectId)
    .single();
  if (!subject) return { ok: false, reason: "error" };
  // Live batches have a fixed access window — no extensions.
  if ((Number((subject as { batch_months?: number | null }).batch_months) || 0) > 0) return { ok: false, reason: "atcap" };

  // The student's active subscription for this subject (latest expiry).
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, months_total, ends_at, plan_id")
    .eq("student_id", user.id)
    .eq("subject_id", input.subjectId)
    .eq("status", "active")
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return { ok: false, reason: "nosub" };

  const { data: course } = await supabase
    .from("courses")
    .select("max_subscription_months")
    .eq("id", subject.course_id)
    .maybeSingle();
  const cap = Number(course?.max_subscription_months) || 36;

  const baseMonths = subject.validity_months || 12;
  const current = Number(sub.months_total) || baseMonths;
  const newTotal = Math.min(cap, current + add);
  const effAdd = newTotal - current;
  if (effAdd <= 0) return { ok: false, reason: "atcap" };

  // Marginal price for the extra months at the student's ladder position.
  const { parseSlabs, slabTotal } = await import("@/lib/pricing");
  const slabs = parseSlabs((subject as { gold_slabs?: unknown }).gold_slabs);
  let baseAmount: number;
  if (slabs) {
    baseAmount = slabTotal(slabs, newTotal) - slabTotal(slabs, current);
  } else {
    if (!subject.gold_price_inr || subject.gold_price_inr <= 0) return { ok: false, reason: "noprice" };
    baseAmount = Math.max(1, Math.round((subject.gold_price_inr * effAdd) / baseMonths));
  }
  if (baseAmount <= 0) return { ok: false, reason: "noprice" };

  // Live sale applies to extensions too, then coupon.
  {
    const { saleFromSettings, applySaleDiscount } = await import("@/lib/sale");
    const { data: settings } = await supabase.from("site_settings").select("key, value");
    const sale = saleFromSettings(new Map((settings ?? []).map((r) => [r.key, r.value as string | null])));
    baseAmount = applySaleDiscount(baseAmount, sale);
  }

  let amountInr = baseAmount;
  let couponId = "";
  if (input.couponCode) {
    const applied = await applyCoupon(input.couponCode, baseAmount);
    if (applied) { amountInr = applied.amount; couponId = applied.couponId; }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", user.id)
    .single();

  try {
    const order = await createRazorpayOrder(amountInr, `ext_${Date.now()}`, {
      kind: "extension",
      subscriptionId: sub.id,
      courseId: subject.course_id,
      subjectId: subject.id,
      addMonths: String(effAdd),
      newTotal: String(newTotal),
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
      keyId: await razorpayKeyId(),
      name: "CA Parveen Sharma",
      description: `Extend ${subject.title} · +${effAdd} month${effAdd === 1 ? "" : "s"}`,
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

export async function verifyExtendPayment(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean; courseId?: string }> {
  if (!(await verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature))) {
    return { ok: false };
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  let order;
  try { order = await fetchRazorpayOrder(input.razorpay_order_id); }
  catch { return { ok: false }; }
  const n = order.notes ?? {};
  if (n.kind !== "extension" || n.userId !== user.id) return { ok: false };
  if (order.status !== "paid") return { ok: false };

  const addMonths = Number(n.addMonths) || 0;
  const newTotal = Number(n.newTotal) || 0;
  if (addMonths <= 0) return { ok: false };

  const svc = createServiceClient();
  const { data: sub } = await svc
    .from("subscriptions")
    .select("id, ends_at, months_total")
    .eq("id", n.subscriptionId)
    .maybeSingle();
  if (!sub) return { ok: false };

  // Extend from the current expiry (or now, if already lapsed).
  const from = sub.ends_at && new Date(sub.ends_at) > new Date() ? new Date(sub.ends_at) : new Date();
  from.setMonth(from.getMonth() + addMonths);

  await svc.from("subscriptions")
    .update({ ends_at: from.toISOString(), months_total: newTotal || (Number(sub.months_total) || 0) + addMonths, status: "active" })
    .eq("id", sub.id);
  await svc.from("orders")
    .update({ status: "paid", store_txn_id: input.razorpay_payment_id })
    .eq("razorpay_order_id", input.razorpay_order_id);
  if (n.couponId) await redeemCoupon(n.couponId);

  return { ok: true, courseId: n.courseId };
}
