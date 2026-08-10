import { createServiceClient } from "@/lib/supabase/service";

// EVERY VENDOR'S OWN CODE.
//
// A supporter buys at 25% off the published price and sells at the published
// price; the difference is their margin. That discount needs a code, and the
// code has to be theirs alone — otherwise it is one number that will be passed
// around, posted in a WhatsApp group, and used by students to buy at 25% off
// direct, which destroys the price for every vendor including the one who
// leaked it.
//
// Three things make it theirs:
//
//   scope     "donor"  — only works on an order placed FOR a student, never on
//                        a student buying for themselves.
//   for_email their address — checked against the signed-in account at the
//                        moment of purchase, so the code is useless to anybody
//                        who cannot log in as that vendor.
//   max_uses  null     — unlimited. It is not a one-off promotion; it is the
//                        price they trade at.
//
// So it can be shown openly on their own desk. A code that only works while
// signed in as its owner is not a secret to be kept.

export const SUPPORTER_DISCOUNT_PCT = 25;

/** A readable code from their business name: "Aldine CA" → "ALDINECA25". */
function codeFor(name: string, id: string): string {
  const slug = (name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  // A short tail from the account id keeps two "SHARMA BOOKS" apart without
  // making the code look like a password.
  let h = 0x811c9dc5;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  const tail = h.toString(36).toUpperCase().slice(0, 4);
  return `${slug || "PARTNER"}${SUPPORTER_DISCOUNT_PCT}${tail}`;
}

export type SupporterCoupon = { code: string; percentOff: number | null; amountOffInr: number | null };

/**
 * The vendor's standing discount code, made if they do not have one yet.
 *
 * Idempotent and safe to call on every page load: it looks for a live coupon
 * already locked to their address before it makes anything.
 */
export async function ensureSupporterCoupon(supporterId: string): Promise<SupporterCoupon | null> {
  const svc = createServiceClient();

  const { data: me } = await svc
    .from("profiles")
    .select("email, business_name, full_name, is_supporter, supporter_blocked_at")
    .eq("id", supporterId)
    .maybeSingle();
  const email = String(me?.email ?? "").trim().toLowerCase();
  if (!email || !me?.is_supporter) return null;

  // Already has one? Use it. Matched on the address it is locked to, so a code
  // renamed by hand in Admin → Coupons is still found and never duplicated.
  const { data: existing } = await svc
    .from("coupons")
    .select("code, percent_off, amount_off_inr, is_active")
    .eq("scope", "donor")
    .ilike("for_email", email)
    .order("created_at", { ascending: false })
    .limit(1);
  const found = existing?.[0];
  // Returned exactly as it stands, never assumed to be the standard 25%. One
  // vendor is on a flat-amount arrangement agreed before this existed, and
  // telling them "25% off" would be telling them the wrong trading terms.
  if (found?.is_active) {
    return {
      code: String(found.code),
      percentOff: found.percent_off == null ? null : Number(found.percent_off),
      amountOffInr: found.amount_off_inr == null ? null : Number(found.amount_off_inr),
    };
  }
  // Deactivated by hand is a decision, not an oversight — do not quietly make
  // a second one to replace it.
  if (found) return null;

  const wanted = codeFor(String(me.business_name || me.full_name || ""), supporterId);

  // Someone else may already hold that exact code. Try the plain one first,
  // then walk a suffix rather than failing the page.
  for (let i = 0; i < 5; i++) {
    const code = i === 0 ? wanted : `${wanted}${i + 1}`;
    const { error } = await svc.from("coupons").insert({
      code,
      percent_off: SUPPORTER_DISCOUNT_PCT,
      scope: "donor",
      for_email: email,
      is_active: true,
      max_uses: null,      // unlimited: this is their trading price
      expires_at: null,
    });
    if (!error) return { code, percentOff: SUPPORTER_DISCOUNT_PCT, amountOffInr: null };
    // Anything other than "that code exists" is not ours to work around.
    if (!/duplicate|unique/i.test(error.message ?? "")) return null;
  }
  return null;
}
