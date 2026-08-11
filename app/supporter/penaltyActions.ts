"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  razorpayConfigured, razorpayKeyId, createRazorpayOrder,
  fetchRazorpayOrder, verifyRazorpaySignature,
} from "@/lib/razorpay";
import { PENALTY_INR, releaseOnPenaltyPaid } from "@/lib/supporterHold";

// PAYING THE PENALTY, AND GETTING BACK TO WORK.
//
// A hold that can only be lifted by ringing the office during office hours is a
// hold that costs the vendor a weekend for a page they may already have fixed.
// So it is payable from their own desk, and orders reopen the moment the money
// lands.
//
// The amount is fixed at ₹5,000 in code and never comes from the browser. A
// price posted by the client is a price the client can edit.

export type PenaltyOrder =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; prefill: { name?: string; email?: string; contact?: string } }
  | { ok: false; reason: "auth" | "notheld" | "unconfigured" | "error" };

export async function createPenaltyOrder(): Promise<PenaltyOrder> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles")
    .select("full_name, business_name, email, phone, is_supporter, role, supporter_blocked_at, supporter_penalty_inr")
    .eq("id", user.id).maybeSingle();
  if (!me) return { ok: false, reason: "auth" };
  if (!(me.is_supporter || me.role === "supporter")) return { ok: false, reason: "auth" };

  // Nothing to pay unless there is actually a hold. Without this a vendor could
  // be charged ₹5,000 for nothing by an old tab left open after a release.
  if (!me.supporter_blocked_at) return { ok: false, reason: "notheld" };

  const amount = Number(me.supporter_penalty_inr) || PENALTY_INR;
  try {
    const order = await createRazorpayOrder(amount, `penalty_${user.id.slice(0, 8)}_${Date.now()}`, {
      kind: "supporter_penalty",
      supporterId: user.id,
    });
    return {
      ok: true,
      orderId: order.id,
      amount,
      keyId: await razorpayKeyId(),
      name: "Seller agreement penalty",
      prefill: {
        name: (me.business_name as string) || (me.full_name as string) || undefined,
        email: (me.email as string) || undefined,
        contact: (me.phone as string) || undefined,
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function verifyPenaltyPayment(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean }> {
  // The signature first. Everything below trusts that this order is ours and
  // that Razorpay says it was paid.
  if (!(await verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature))) {
    return { ok: false };
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  let order;
  try {
    order = await fetchRazorpayOrder(input.razorpay_order_id);
  } catch {
    return { ok: false };
  }
  const notes = (order.notes ?? {}) as { kind?: string; supporterId?: string };
  if (notes.kind !== "supporter_penalty" || order.status !== "paid") return { ok: false };
  // The hold that is lifted is the one belonging to the account that paid —
  // read from the order we created, not from anything the browser said.
  if (notes.supporterId !== user.id) return { ok: false };

  await releaseOnPenaltyPaid(user.id, input.razorpay_order_id);

  const { notifyFaculty } = await import("@/lib/notify");
  await notifyFaculty(
    "✅ A seller has paid the penalty and is selling again",
    `Account: ${user.email ?? user.id}\nPayment: ${input.razorpay_payment_id}\nOrder: ${input.razorpay_order_id}\n\n` +
      `The hold has been lifted automatically and they can place orders again.`,
  ).catch(() => {});

  return { ok: true };
}
