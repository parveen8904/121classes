import { createServiceClient } from "@/lib/supabase/service";

// Validate a coupon code and compute the discounted amount. SERVER-ONLY
// (uses the service client so students never read the coupons table directly).
export async function applyCoupon(
  code: string,
  amountInr: number,
): Promise<{ couponId: string; code: string; amount: number } | null> {
  const c = (code || "").trim().toUpperCase();
  if (!c) return null;
  const svc = createServiceClient();
  const { data: coupon } = await svc
    .from("coupons")
    .select("id, code, percent_off, amount_off_inr, is_active, expires_at, max_uses, used_count")
    .eq("code", c)
    .maybeSingle();
  if (!coupon || !coupon.is_active) return null;
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return null;
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) return null;

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
