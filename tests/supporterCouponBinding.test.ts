import { readFileSync } from "node:fs";
import { join } from "node:path";

// A VENDOR'S CODE IS SHOWN TO THEM IN PLAIN SIGHT, SO IT MUST BE USELESS TO
// ANYBODY ELSE.
//
// It sits on their desk, unmasked, and it will be photographed, forwarded and
// eventually posted in a student WhatsApp group. That is fine — but only while
// all three of these hold:
//
//   scope "donor"    a student buying for themselves cannot use it
//   for_email        it is checked against the signed-in account at purchase
//   max_uses null    unlimited, because it is a trading price, not a promotion
//
// Drop the first two and the 25% becomes a public discount on the whole
// catalogue. This walks the code that grants and checks it, so neither can be
// loosened without someone deciding to.

const root = join(import.meta.dirname, "..");
const grant = readFileSync(join(root, "lib", "supporterCoupon.ts"), "utf8");
const check = readFileSync(join(root, "lib", "coupons.ts"), "utf8");
const order = readFileSync(join(root, "app", "gift", "actions.ts"), "utf8");

let fails = 0;
const must = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

// ── What is granted ────────────────────────────────────────────────────────
must(/scope:\s*"donor"/.test(grant), 'a new vendor code must be scope "donor" — otherwise students can use it');
must(/for_email:\s*email/.test(grant), "a new vendor code must be locked to their email address");
must(/max_uses:\s*null/.test(grant), "a vendor code must be unlimited — it is their price, not a promotion");
must(/expires_at:\s*null/.test(grant), "a vendor code must not expire");
must(/percent_off:\s*SUPPORTER_DISCOUNT_PCT/.test(grant), "the discount must come from the one named constant");

// It must not invent a code for somebody who is not a supporter, or whose code
// was switched off on purpose.
must(/is_supporter/.test(grant), "only a supporter gets a vendor code");
must(/if \(found\) return null;/.test(grant), "a code deactivated by hand must not be silently replaced");

// ── What is checked at the moment of purchase ──────────────────────────────
must(/coupon\.scope\s*&&\s*coupon\.scope\s*!==\s*"any"\s*&&\s*coupon\.scope\s*!==\s*kind/.test(check),
  "applyCoupon must refuse a coupon whose scope does not match the purchase");
must(/coupon\.for_email\s*&&/.test(check) && /return null/.test(check),
  "applyCoupon must refuse a locked coupon when the address does not match");
must(/is_active/.test(check), "an inactive coupon must be refused");
must(/max_uses\s*!=\s*null\s*&&\s*coupon\.used_count\s*>=\s*coupon\.max_uses/.test(check),
  "a capped coupon must stop at its cap");

// ── And that the order actually passes the signed-in vendor, not the student ─
must(/kind:\s*"donor",\s*email:\s*user\.email/.test(order.replace(/\s+/g, " ")),
  "a supporter order must check the coupon against the SIGNED-IN vendor's email, not the student's");

console.log(fails === 0 ? "PASS  supporter coupon: donor-scoped, email-locked, unlimited, and checked against the signed-in vendor" : "");
process.exit(fails === 0 ? 0 : 1);
