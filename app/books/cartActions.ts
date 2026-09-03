"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  razorpayConfigured,
  razorpayKeyId,
  createRazorpayOrder,
  verifyRazorpaySignature,
} from "@/lib/razorpay";
import { toAddress, addressProblems, sameAddress, type Address } from "@/lib/address";
import { checkGstin } from "@/lib/gstin";

/**
 * WHAT WE ALREADY KNOW ABOUT THE BUYER, SO THEY TYPE IT ONCE IN A LIFETIME.
 *
 * His instruction, 2 September 2026: the addresses are posted to the profile,
 * and a GST number held on the profile "must be there" on the next order
 * without being asked for again.
 *
 * A guest gets empty fields, which is correct — we know nothing about them and
 * must not pretend to.
 */
export async function myAddressBook(): Promise<{
  signedIn: boolean; name: string; email: string;
  shipping: Address; billing: Address; gstin: string; hasProfileGstin: boolean; tradeName: string;
}> {
  const blank = {
    signedIn: false, name: "", email: "",
    shipping: toAddress(null), billing: toAddress(null), gstin: "", hasProfileGstin: false, tradeName: "",
  };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return blank;
  const { data: p } = await supabase.from("profiles")
    .select("full_name, email, phone, shipping_address, business_name, trade_name, address_line1, address_line2, city, state, country, pincode, gstin")
    .eq("id", user.id).maybeSingle();
  const name = String(p?.full_name ?? "");
  const phone = String(p?.phone ?? "");
  const ship = toAddress(p?.shipping_address);
  // The billing address is the profile's own flat columns — the ones the tax
  // invoice reads, and the ones whose STATE decides CGST+SGST against IGST.
  // There is no second copy of it.
  const bill = toAddress({
    name: p?.trade_name || p?.business_name || name,
    line1: p?.address_line1, line2: p?.address_line2,
    city: p?.city, state: p?.state, pincode: p?.pincode, country: p?.country, phone,
  });
  return {
    signedIn: true,
    name,
    email: String(p?.email ?? user.email ?? ""),
    // A profile that has a name and phone but no address yet still fills in
    // the two fields it can.
    shipping: { ...ship, name: ship.name || name, phone: ship.phone || phone },
    billing: { ...bill, name: bill.name || name, phone: bill.phone || phone },
    gstin: String(p?.gstin ?? ""),
    hasProfileGstin: !!String(p?.gstin ?? "").trim(),
    // Exactly as the GST register spelled it, when a lookup has ever run.
    tradeName: String(p?.trade_name ?? ""),
  };
}

/**
 * VERIFY A GST NUMBER, AND FETCH WHAT ONLY THE REGISTER KNOWS.
 *
 * Ravi's spec: the number is verified, and on success the trade name, billing
 * address, state, city and PIN fill themselves in — with the name spelled
 * exactly as the register spells it.
 *
 * Two outcomes are deliberately different, because conflating them would make
 * a correct number look forged: `ok:false, configured:false` means we could not
 * LOOK, and `ok:false, configured:true` means the lookup answered and refused.
 * Either way the check digit and the state have already been read out of the
 * number itself, which needs nobody.
 */
export async function verifyGstin(raw: string): Promise<{
  valid: boolean; problem: string | null; state: string | null; pan: string | null;
  fetched: boolean; note: string | null;
  /** Whether a lookup service is connected at all.
   *
   *  Without this the screen could not tell "the provider refused" from "there
   *  is no provider", and said the same discouraging thing either way — which
   *  is why a perfectly good verification was reported to the founder as
   *  "verify GST not working". */
  configured: boolean;
  party: { tradeName: string | null; legalName: string | null; line1: string | null; line2: string | null;
           city: string | null; state: string | null; pincode: string | null; status: string | null } | null;
}> {
  const { checkGstin, fetchGstParty } = await import("@/lib/gstin");
  const { getSecret } = await import("@/lib/secrets");
  const c = checkGstin(raw);
  if (!c.ok) {
    return { valid: false, problem: c.problem, state: null, pan: null, fetched: false, note: null, configured: true, party: null };
  }
  const [baseUrl, key] = await Promise.all([getSecret("GST_LOOKUP_URL"), getSecret("GST_LOOKUP_KEY")]);
  const look = await fetchGstParty(c.gstin, { baseUrl, key });
  if (look.ok) {
    return {
      valid: true, problem: null, state: c.state, pan: c.pan, fetched: true, note: null, configured: true,
      party: {
        tradeName: look.party.tradeName, legalName: look.party.legalName,
        line1: look.party.line1, line2: look.party.line2,
        city: look.party.city, state: look.party.state ?? c.state, pincode: look.party.pincode,
        status: look.party.status,
      },
    };
  }
  return {
    valid: true, problem: null, state: c.state, pan: c.pan, fetched: false,
    note: look.reason, configured: look.configured, party: null,
  };
}

/**
 * PERSIST WHAT THE CONFIRM STEP PRODUCED, BEFORE A PAYMENT OPENS.
 *
 * The book checkouts carry the confirmed details in the Razorpay order notes,
 * because a book order may be placed by a guest with no profile at all. A
 * course enrolment is different: the buyer is signed in by definition and
 * createPlanOrder reads the address off the PROFILE, so the confirmed details
 * have to be on the profile before the gateway opens.
 *
 * Same destinations as the book flow — the billing address goes to the flat
 * columns the invoice reads, so the two routes cannot disagree.
 */
export async function saveConfirmedDetails(d: CheckoutDetails): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const billing = toAddress(d?.billing);
  const shipping = d?.shipTo === "different" ? toAddress(d?.shipping) : { ...billing };
  const bad = addressProblems(billing, { needPhone: false, indiaOnly: false });
  if (bad.length) return { ok: false, error: `Billing address still needs: ${bad.join(", ")}.` };

  const gstinRaw = String(d?.gstin ?? "").trim();
  const gst = gstinRaw ? checkGstin(gstinRaw) : null;
  if (gst && !gst.ok) return { ok: false, error: gst.problem ?? "That GST number is not valid." };

  const patch: Record<string, unknown> = {
    address_line1: billing.line1,
    address_line2: billing.line2 || null,
    city: billing.city,
    state: billing.state || null,
    country: billing.country || "India",
    pincode: billing.pincode || null,
    shipping_address: shipping,
  };
  if (gst?.ok) patch.gstin = gst.gstin;
  const trade = String(d?.tradeName ?? "");
  if (trade) { patch.trade_name = trade; patch.business_name = trade; }

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) return { ok: false, error: "Could not save that — please try again." };
  return { ok: true };
}

export type CartBook = { id: string; title: string; author: string | null; cover_url: string | null; price_inr: number; stock_qty: number };

// Fresh titles/prices/stock for the ids in the visitor's cart.
export async function getCartBooks(ids: string[]): Promise<CartBook[]> {
  if (!ids?.length) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("books")
    .select("id, title, author, cover_url, price_inr, stock_qty")
    .in("id", ids.slice(0, 20))
    .eq("is_active", true);
  return (data ?? []) as CartBook[];
}

export type CartOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name: string; email: string; contact: string } }
  | { ok: false; reason: "unconfigured" | "oos" | "invalid" | "empty" | "error"; title?: string; missing?: string[] };

/**
 * WHAT THE CHECKOUT SENDS.
 *
 * Ravi's spec puts BILLING first and derives shipping from it: "Add Same as
 * Billing Address and Ship to a Different Address options. Neither option
 * should be selected by default... No option selected → Billing Address should
 * be considered as Shipping Address."
 *
 * So `shipTo` has three states and the third is not an error — it is the
 * documented default behaviour, and it is why this is a string rather than a
 * boolean. A boolean would have to pick a side, which is exactly what the spec
 * says not to do.
 */
export type ShipChoice = "same" | "different" | "unset";

export type CheckoutDetails = {
  email: string;
  billing: Address;
  shipTo: ShipChoice;
  /** Read only when shipTo === "different". */
  shipping: Address;
  gstin: string;
  /** Exactly as the GST register spells it; blank when there is no GSTIN. */
  tradeName: string;
  legalName: string;
};

// One Razorpay order for the whole cart. Prices come from the DB — never from
// the client. Items are carried in the order notes and written to book_orders
// after the payment verifies.
export async function createCartOrder(input: { items: { bookId: string; qty: number }[]; buyer: CheckoutDetails }): Promise<CartOrderResult> {
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };
  const d = input.buyer;

  // BILLING IS THE ADDRESS; SHIPPING IS DERIVED FROM IT.
  //
  // Ravi's spec: "Neither option should be selected by default... No option
  // selected → Billing Address should be considered as Shipping Address." So
  // "unset" is not a failure to answer, it is the documented default, and the
  // copy is made HERE — a form can send anything, and the two addresses on the
  // invoice and the label must be the ones we decided, not the ones posted.
  const billing = toAddress(d?.billing);
  const shipping = d?.shipTo === "different" ? toAddress(d?.shipping) : { ...billing };

  const missing = [
    ...addressProblems(billing, { needPhone: false, indiaOnly: false }).map((m) => `billing: ${m}`),
    // The parcel goes to the shipping address, so that one needs a phone the
    // courier can ring — even when it is a copy of the billing address.
    ...addressProblems(shipping).map((m) => `delivery: ${m}`),
  ];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d?.email ?? "").trim())) missing.push("an email address for the invoice");

  // A GST number is optional; a WRONG one is not. It carries its own check
  // digit, so a mistyped character is caught before the invoice is raised
  // rather than after it has been filed.
  const gstinRaw = String(d?.gstin ?? "").trim();
  const gst = gstinRaw ? checkGstin(gstinRaw) : null;
  if (gst && !gst.ok) missing.push(`GST number — ${gst.problem}`);

  if (missing.length) return { ok: false, reason: "invalid", missing };
  const wanted = (input.items ?? [])
    .map((i) => ({ bookId: String(i.bookId), qty: Math.max(1, Math.min(20, Math.floor(i.qty || 1))) }))
    .slice(0, 10);
  if (!wanted.length) return { ok: false, reason: "empty" };

  const supabase = createClient();
  const { data: books } = await supabase
    .from("books")
    .select("id, title, price_inr, stock_qty, is_active")
    .in("id", wanted.map((w) => w.bookId));
  const byId = new Map((books ?? []).map((x) => [x.id as string, x]));

  let total = 0;
  const items: { b: string; q: number; p: number }[] = [];
  const titles: string[] = [];
  for (const w of wanted) {
    const bk = byId.get(w.bookId);
    if (!bk || !bk.is_active) return { ok: false, reason: "oos", title: bk?.title as string | undefined };
    if ((bk.stock_qty as number) < w.qty) return { ok: false, reason: "oos", title: bk.title as string };
    total += (bk.price_inr as number) * w.qty;
    items.push({ b: w.bookId, q: w.qty, p: bk.price_inr as number });
    titles.push(`${bk.title} × ${w.qty}`);
  }
  if (total <= 0) return { ok: false, reason: "empty" };

  const { data: { user } } = await supabase.auth.getUser();

  try {
    const order = await createRazorpayOrder(total, `cart_${Date.now()}`, {
      kind: "book_cart",
      items: JSON.stringify(items),
      name: shipping.name,
      email: String(d.email).trim(),
      phone: shipping.phone,
      ship: JSON.stringify(shipping),
      // Carried separately so an invoice can be made out to one place while
      // the parcel goes to another — which is the whole point of a sponsored
      // order: billed to the supporter, delivered to the student.
      bill: JSON.stringify(billing),
      gstin: gst?.ok ? gst.gstin : "",
      trade: String(d?.tradeName ?? "").slice(0, 200),
      userId: user?.id ?? "",
    });
    return {
      ok: true,
      orderId: order.id,
      amount: order.amount,
      keyId: await razorpayKeyId(),
      name: "CA Parveen Sharma — Books",
      description: titles.join(", ").slice(0, 250),
      prefill: { name: shipping.name, email: String(d.email).trim(), contact: shipping.phone },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function verifyCartPayment(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean }> {
  if (!(await verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature))) {
    return { ok: false };
  }
  // EVERYTHING AFTER THE SIGNATURE NOW LIVES IN ONE PLACE.
  //
  // It used to live here, and only here — which is why a book paid for on 2
  // September existed at Razorpay and nowhere else: this code only ever runs
  // in the buyer's browser, and a browser that never comes back never runs it.
  // The same work is now done by lib/bookOrderFinish.ts, which a sweep can
  // also call from the server when the browser drops. One implementation, so
  // a recovered order and a normal one cannot drift apart.
  const { finishBookOrderFromRazorpay } = await import("@/lib/bookOrderFinish");
  const r = await finishBookOrderFromRazorpay(input.razorpay_order_id, input.razorpay_payment_id);
  return { ok: r.ok };
}
