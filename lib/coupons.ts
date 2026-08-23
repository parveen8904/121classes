import { createServiceClient } from "@/lib/supabase/service";

// Validate a coupon code and compute the discounted amount. SERVER-ONLY
// (uses the service client so students never read the coupons table directly).
export async function applyCoupon(
  code: string,
  amountInr: number,
  ctx: { kind?: "user" | "donor"; email?: string | null; userId?: string | null } = {},
): Promise<{ couponId: string; code: string; amount: number } | null> {
  const c = (code || "").trim().toUpperCase();
  if (!c) return null;
  const svc = createServiceClient();
  const { data: coupon } = await svc
    .from("coupons")
    .select("id, code, percent_off, amount_off_inr, is_active, expires_at, max_uses, used_count, scope, for_email")
    .eq("code", c)
    .maybeSingle();
  if (!coupon || !coupon.is_active) return null;
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return null;
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) return null;
  // Scope: a "donor" coupon only works on gift purchases, a "user" coupon only
  // on self-purchases; "any" works everywhere. Default context = user.
  const kind = ctx.kind ?? "user";
  if (coupon.scope && coupon.scope !== "any" && coupon.scope !== kind) return null;
  // OPTIONAL LOCK TO ONE PERSON — AND A PERSON HAS MORE THAN ONE ADDRESS.
  //
  // A supporter's code is created against their PROFILE email (the trading
  // address on their invoices) but was checked against the address they SIGN IN
  // with. For anyone whose login differs from their business address those are
  // two different strings, so their own 25% code was refused on every order —
  // "not valid, has expired, or is not for this purchase" — with nothing wrong
  // with the coupon at all. Self-purchase was worse: the plans page passed no
  // address whatsoever, so an email-locked scholarship code could never be
  // redeemed by the very student it was written for.
  //
  // So identity is now the SET of addresses that belong to the caller: the one
  // they signed in with, and the one on their profile. Matching either is
  // matching them.
  if (coupon.for_email) {
    const want = String(coupon.for_email).trim().toLowerCase();
    const mine = new Set<string>();
    const add = (e: unknown) => { const v = String(e ?? "").trim().toLowerCase(); if (v) mine.add(v); };
    add(ctx.email);
    if (ctx.userId) {
      const { data: prof } = await svc.from("profiles").select("email").eq("id", ctx.userId).maybeSingle();
      add(prof?.email);
    }
    if (!mine.has(want)) return null;
  }

  let amount = amountInr;
  if (coupon.percent_off) amount = Math.round(amountInr * (1 - coupon.percent_off / 100));
  else if (coupon.amount_off_inr) amount = amountInr - coupon.amount_off_inr;
  amount = Math.max(1, amount);

  return { couponId: coupon.id, code: coupon.code, amount };
}

export async function redeemCoupon(couponId: string): Promise<void> {
  try {
    const svc = createServiceClient();
    const { data } = await svc.from("coupons").select("used_count").eq("id", couponId).maybeSingle();
    if (data) await svc.from("coupons").update({ used_count: (data.used_count ?? 0) + 1 }).eq("id", couponId);
  } catch {
    // best-effort
  }
}
