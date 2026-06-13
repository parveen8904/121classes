"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  razorpayConfigured,
  createRazorpayOrder,
  fetchRazorpayOrder,
  verifyRazorpaySignature,
} from "@/lib/razorpay";

export type ComboOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name?: string; email?: string; contact?: string } }
  | { ok: false; reason: "unconfigured" | "auth" | "invalid" | "error" };

export async function createComboOrder(input: { comboId: string }): Promise<ComboOrderResult> {
  if (!razorpayConfigured()) return { ok: false, reason: "unconfigured" };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };

  const { data: combo } = await supabase
    .from("combos")
    .select("id, title, price_inr, tier, months, is_active")
    .eq("id", input.comboId)
    .maybeSingle();
  if (!combo || !combo.is_active) return { ok: false, reason: "invalid" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", user.id)
    .single();

  try {
    const order = await createRazorpayOrder(combo.price_inr, `combo_${Date.now()}`, {
      kind: "combo",
      comboId: combo.id,
      tier: combo.tier,
      months: String(combo.months),
      userId: user.id,
    });
    return {
      ok: true,
      orderId: order.id,
      amount: order.amount,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID!,
      name: "1:1 CA Classes",
      description: combo.title,
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

export async function verifyComboPayment(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean }> {
  if (
    !verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)
  ) {
    return { ok: false };
  }
  let order;
  try {
    order = await fetchRazorpayOrder(input.razorpay_order_id);
  } catch {
    return { ok: false };
  }
  const n = order.notes ?? {};
  if (n.kind !== "combo" || order.status !== "paid") return { ok: false };

  const svc = createServiceClient();
  const { data: items } = await svc.from("combo_items").select("subject_id").eq("combo_id", n.comboId);
  const subjectIds = (items ?? []).map((i) => i.subject_id);
  if (!subjectIds.length) return { ok: false };

  const { data: subjects } = await svc.from("subjects").select("id, course_id").in("id", subjectIds);
  const { data: plan } = await svc
    .from("plans")
    .select("id")
    .eq("tier", n.tier)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!plan) return { ok: false };

  const months = Number(n.months) || 6;
  const ends = new Date();
  ends.setMonth(ends.getMonth() + months);

  await svc.from("subscriptions").insert(
    (subjects ?? []).map((s) => ({
      student_id: n.userId,
      course_id: s.course_id,
      subject_id: s.id,
      plan_id: plan.id,
      channel: "web",
      ends_at: ends.toISOString(),
      status: "active",
      auto_renew: false,
    })),
  );

  return { ok: true };
}
