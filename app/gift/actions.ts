"use server";
import { formatDate } from "@/lib/dates";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { randomUUID } from "node:crypto";
import {
  razorpayConfigured, razorpayKeyId, createRazorpayOrder, fetchRazorpayOrder, verifyRazorpaySignature,
} from "@/lib/razorpay";
import { sendEmail, sendEmailWithAttachment, emailShell } from "@/lib/notify";
import { getGstSettings, computeGst, nextInvoiceNo, nextReceiptNo, buildInvoicePdf } from "@/lib/invoice";
import { applyCoupon, redeemCoupon } from "@/lib/coupons";

const SITE = "https://caparveensharma.com";
const PAID = ["silver", "gold"];

type GiftInput = {
  subjectId: string; tier: string; months?: number; couponCode?: string;
  // When access should BEGIN. A supporter often sells in July for a course
  // starting in October; without this the clock started at payment and the
  // student quietly lost those months.
  startsOn?: string;
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

  // A BLOCKED SUPPORTER MAY LOOK, BUT NOT SELL.
  //
  // When a breach is upheld the account stays open — they keep their orders,
  // their invoices and their students — but no new order can be placed until
  // the penalty is settled. Locking them out entirely would punish the students
  // they have already sold to.
  //
  // Checked here, in the one place an order is actually created, rather than by
  // hiding a button: a hidden button is a suggestion, and this is a rule.
  const { supporterReadiness } = await import("@/lib/supporterReady");
  // Written out rather than built from SUPPORTER_READY_COLUMNS: PostgREST types
  // this string at compile time and a template literal defeats it.
  const { data: seller } = await svc
    .from("profiles")
    .select("full_name, business_name, phone, email, address_line1, city, state, pincode, supporter_site, supporter_site_ok_at, supporter_terms_at, supporter_blocked_at, supporter_block_reason, is_supporter, role")
    .eq("id", user.id)
    .maybeSingle();

  // COMPLETE, PROVED, AGREED AND NOT ON HOLD — or no order.
  //
  // The same function the sell page uses, so the screen and the server can
  // never disagree about who may trade. They had already drifted once: the page
  // let a vendor fill in a student's name, address and term, and only the
  // payment button said no.
  const isSupporter = seller?.is_supporter || (seller as { role?: string } | null)?.role === "supporter";
  if (isSupporter && (seller as { role?: string } | null)?.role !== "admin") {
    const state = supporterReadiness(seller as never);
    if (!state.ready) return { ok: false, reason: state.blocked ? "blocked" : "incomplete" };
  }

  const { data: subject } = await svc.from("subjects").select("id, title, course_id, gold_price_inr, validity_months, gold_slabs, batch_months, batch_price_inr").eq("id", input.subjectId).single();
  if (!subject) return { ok: false, reason: "error" };
  const { data: plan } = await svc.from("plans").select("id, name, web_price_inr").eq("tier", input.tier).eq("is_active", true).order("rank").limit(1).maybeSingle();
  if (!plan) return { ok: false, reason: "noplan" };

  const baseMonths = subject.validity_months || 12;
  const batchMonths = Number((subject as { batch_months?: number | null }).batch_months) || 0;
  let months = baseMonths, amount: number | null;
  if (batchMonths > 0) {
    // Live batch: one fixed-price package, fixed duration.
    const price = Number((subject as { batch_price_inr?: number | null }).batch_price_inr) || 0;
    if (price <= 0) return { ok: false, reason: "noprice" };
    months = batchMonths;
    amount = price;
  } else if (input.tier === "gold") {
    // A supporter sale is never shorter than a year — the short slabs are
    // priced for students topping up, not for a first sale. Enforced here as
    // well as in the form, because the form is not what charges the card.
    const { SELL_MIN_MONTHS, SELL_MAX_MONTHS } = await import("@/lib/supporterCatalogue");
    months = input.months
      ? Math.min(SELL_MAX_MONTHS, Math.max(SELL_MIN_MONTHS, Math.round(input.months)))
      : baseMonths;
    // Same ladder as student checkout: slabTotal when the subject has one.
    const { parseSlabs, slabTotal } = await import("@/lib/pricing");
    const slabs = parseSlabs((subject as { gold_slabs?: unknown }).gold_slabs);
    if (slabs) amount = slabTotal(slabs, months);
    else if (subject.gold_price_inr && subject.gold_price_inr > 0) amount = Math.max(1, Math.round((subject.gold_price_inr * months) / baseMonths));
    else return { ok: false, reason: "noprice" };
  } else {
    amount = plan.web_price_inr;
    if (!amount || amount <= 0) return { ok: false, reason: "noprice" };
  }

  // Optional coupon (donor-scoped coupons apply here).
  let couponId = "";
  if (input.couponCode) {
    const applied = await applyCoupon(input.couponCode, amount, { kind: "donor", email: user.email, userId: user.id });
    if (applied) { amount = applied.amount; couponId = applied.couponId; }
  }

  const s = await getGstSettings();
  const gst = computeGst(amount, input.billing.state, s);

  // 9+ month Gold gifts ship FREE printed books — the recipient's address is
  // mandatory BEFORE payment so no order ever needs a chase-up call.
  //
  // And it must be an address we can actually post to. The form now asks for
  // the parts and only offers Indian states, but the form is the browser's copy
  // of the rules and anybody can post past it. There is no international parcel
  // service on this account, so an order taken for an address abroad is an
  // order that cannot be fulfilled — and the student finds that out weeks
  // later, having paid.
  // A FOREIGN ADDRESS IS A FINE ADDRESS. IT IS JUST NOT A PARCEL.
  //
  // We do not courier books outside India — there is no international service
  // on this account. That is a reason not to raise a parcel, NOT a reason to
  // refuse the sale: the student still gets the whole course and the free PDF
  // books, and if they want the printed set they can give an Indian address of
  // somebody who will forward it on.
  //
  // So the address is still required, and still checked — but only for being
  // there. Whether a parcel goes is decided separately, below.
  if (!(input.recipient.address ?? "").trim()) return { ok: false, reason: "address" };
  const { looksPostableInIndia } = await import("@/lib/indiaStates");
  const canPost = looksPostableInIndia(input.recipient.address);

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
      starts_on: input.startsOn || null,
      coupon_code: input.couponCode || null,
      // Gifted Gold of 9+ months ships the FREE printed books to the recipient
      // (unlike admin grants, which never include books).
      // Books only where a courier can reach. A parcel raised for an address
      // abroad sits in the warehouse queue for ever and nobody can close it.
      books_due: input.tier === "gold" && months >= 9 && canPost,
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

  // The whole of provisioning lives in lib/giftProvision so it can ALSO run
  // with no browser in the loop — the reconcile sweep and the admin's manual
  // confirm call the same function, and a vendor's dropped connection can no
  // longer leave a paid student unenrolled.
  const { provisionPaidGiftOrder } = await import("@/lib/giftProvision");
  await provisionPaidGiftOrder(g as never, input.razorpay_payment_id, {
    gifterEmail: user.email || null,
    couponId: (order.notes as { couponId?: string })?.couponId ?? null,
  });
  return { ok: true };
}

/**
 * Check a coupon and say what the supporter will actually pay — BEFORE paying.
 *
 * The discount was only ever applied inside createGiftOrder, so the button said
 * "Pay ₹27,000" while Razorpay charged less. A supporter had no way to tell,
 * before committing, whether their code had worked at all — and a code that was
 * expired or wrong failed in silence, with the full amount taken.
 *
 * The price is worked out here on the server from the subject's own pricing,
 * never from anything the browser sends, so the figure shown is the figure
 * charged.
 */
export async function previewGiftPrice(input: { subjectId: string; couponCode?: string; months?: number }): Promise<
  | { ok: true; base: number; payable: number; discount: number; couponApplied: boolean; couponCode: string | null; months: number }
  | { ok: false; reason: "auth" | "error" | "noprice" | "badcoupon"; base?: number; months?: number }
> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth" };

  const svc = createServiceClient();
  const { data: subject } = await svc
    .from("subjects")
    .select("id, validity_months, gold_price_inr, gold_slabs, batch_months, batch_price_inr")
    .eq("id", input.subjectId)
    .single();
  if (!subject) return { ok: false, reason: "error" };

  // The SAME ladder createGiftOrder uses. Two copies of a price calculation is
  // how the button and the invoice come to disagree, so if this ever moves it
  // moves in both places.
  const baseMonths = subject.validity_months || 12;
  const batchMonths = Number((subject as { batch_months?: number | null }).batch_months) || 0;
  let months = baseMonths;
  let base: number;
  if (batchMonths > 0) {
    const price = Number((subject as { batch_price_inr?: number | null }).batch_price_inr) || 0;
    if (price <= 0) return { ok: false, reason: "noprice" };
    months = batchMonths;
    base = price;
  } else {
    const { SELL_MIN_MONTHS, SELL_MAX_MONTHS } = await import("@/lib/supporterCatalogue");
    // Clamped here, on the server. A term typed into the request cannot buy a
    // year's access for a month's money.
    months = Math.min(SELL_MAX_MONTHS, Math.max(SELL_MIN_MONTHS, Math.round(input.months || baseMonths)));
    const { parseSlabs, slabTotal } = await import("@/lib/pricing");
    const slabs = parseSlabs((subject as { gold_slabs?: unknown }).gold_slabs);
    if (slabs) base = slabTotal(slabs, months);
    else if (subject.gold_price_inr && subject.gold_price_inr > 0) {
      base = Math.max(1, Math.round((subject.gold_price_inr * months) / baseMonths));
    } else return { ok: false, reason: "noprice" };
  }

  const code = (input.couponCode ?? "").trim();
  if (!code) {
    return { ok: true, base, payable: base, discount: 0, couponApplied: false, couponCode: null, months };
  }

  const applied = await applyCoupon(code, base, { kind: "donor", email: user.email, userId: user.id });
  // A code that does not work is SAID to not work. It used to be dropped
  // quietly and the full amount charged.
  if (!applied) return { ok: false, reason: "badcoupon", base, months };

  return {
    ok: true, base, payable: applied.amount, discount: base - applied.amount,
    couponApplied: true, couponCode: applied.code, months,
  };
}
