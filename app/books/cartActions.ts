"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  razorpayConfigured,
  razorpayKeyId,
  createRazorpayOrder,
  fetchRazorpayOrder,
  verifyRazorpaySignature,
} from "@/lib/razorpay";
import { notifyByEmail, emailShell } from "@/lib/notify";
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
  shipping: Address; billing: Address; gstin: string; hasProfileGstin: boolean;
}> {
  const blank = {
    signedIn: false, name: "", email: "",
    shipping: toAddress(null), billing: toAddress(null), gstin: "", hasProfileGstin: false,
  };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return blank;
  const { data: p } = await supabase.from("profiles")
    .select("full_name, email, phone, shipping_address, business_name, address_line1, address_line2, city, state, pincode, gstin")
    .eq("id", user.id).maybeSingle();
  const name = String(p?.full_name ?? "");
  const phone = String(p?.phone ?? "");
  const ship = toAddress(p?.shipping_address);
  // The billing address is the profile's own flat columns — the ones the tax
  // invoice reads, and the ones whose STATE decides CGST+SGST against IGST.
  // There is no second copy of it.
  const bill = toAddress({
    name: p?.business_name || name,
    line1: p?.address_line1, line2: p?.address_line2,
    city: p?.city, state: p?.state, pincode: p?.pincode, phone,
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
  };
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

/** What the checkout sends: two addresses, a flag, and an optional GST number. */
export type CheckoutDetails = {
  email: string;
  shipping: Address;
  /** Ignored when sameAsShipping — the buyer should not have to fill it twice. */
  billing: Address;
  sameAsShipping: boolean;
  gstin: string;
};

// One Razorpay order for the whole cart. Prices come from the DB — never from
// the client. Items are carried in the order notes and written to book_orders
// after the payment verifies.
export async function createCartOrder(input: { items: { bookId: string; qty: number }[]; buyer: CheckoutDetails }): Promise<CartOrderResult> {
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };
  const d = input.buyer;

  // TWO ADDRESSES, AND THE SECOND ONE IS OPTIONAL WORK.
  //
  // His instruction: "I also want that student be given choice of telling
  // whether the billing address and shipping address is same so that he has
  // not to fill the address again." So when the box is ticked the billing
  // address is simply the shipping one — copied here, on the server, rather
  // than trusted from a form that could send anything.
  const shipping = toAddress(d?.shipping);
  const billing = d?.sameAsShipping ? { ...shipping } : toAddress(d?.billing);

  const missing = [
    ...addressProblems(shipping).map((m) => `delivery: ${m}`),
    ...(d?.sameAsShipping ? [] : addressProblems(billing, { needPhone: false }).map((m) => `billing: ${m}`)),
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
  let order;
  try { order = await fetchRazorpayOrder(input.razorpay_order_id); }
  catch { return { ok: false }; }
  const n = order.notes ?? {};
  if (n.kind !== "book_cart" || order.status !== "paid") return { ok: false };

  const items = (() => { try { return JSON.parse(n.items) as { b: string; q: number; p: number }[]; } catch { return []; } })();
  const ship = toAddress((() => { try { return JSON.parse(n.ship); } catch { return {}; } })());
  const bill = toAddress((() => { try { return JSON.parse(n.bill ?? "{}"); } catch { return {}; } })());
  const gstin = String(n.gstin ?? "").trim();
  if (!items.length) return { ok: false };

  const svc = createServiceClient();
  await svc.from("book_orders").insert({
    student_id: n.userId || null,
    guest_contact: { name: n.name, email: n.email, phone: n.phone },
    items: items.map((i) => ({ book_id: i.b, qty: i.q, price_inr: i.p })),
    amount_inr: order.amount / 100,
    razorpay_order_id: order.id,
    ship_to: ship,
    // Frozen at the order. The profile may be edited tomorrow; an invoice must
    // keep saying what it said on the day.
    bill_to: bill,
    gstin: gstin || null,
    status: "paid",
  });

  // THE ADDRESSES GO BACK TO THE PROFILE. His instruction: "you will post
  // these addresses to the profile." Only for someone signed in — a guest has
  // no profile to write to — and only what they actually gave us, so a blank
  // billing address never wipes a good one already on file.
  if (n.userId) {
    const patch: Record<string, unknown> = { shipping_address: ship };
    // The billing address goes back to the flat columns the invoice reads —
    // state included, because that is what decides the tax split.
    if (bill.line1 && bill.city) {
      patch.address_line1 = bill.line1;
      patch.address_line2 = bill.line2 || null;
      patch.city = bill.city;
      patch.state = bill.state || null;
      patch.pincode = bill.pincode || null;
    }
    if (gstin) patch.gstin = gstin;
    try { await svc.from("profiles").update(patch).eq("id", n.userId); }
    catch { /* the order stands whatever the profile does */ }
  }

  // Decrement stock per title (best-effort) and gather names for the email.
  const { data: books } = await svc.from("books").select("id, title, stock_qty").in("id", items.map((i) => i.b));
  const titleById = new Map((books ?? []).map((x) => [x.id as string, x]));
  for (const i of items) {
    const bk = titleById.get(i.b);
    if (bk) await svc.from("books").update({ stock_qty: Math.max(0, (bk.stock_qty as number) - i.q) }).eq("id", i.b);
  }
  const lines = items.map((i) => `<li><strong>${titleById.get(i.b)?.title ?? "Book"}</strong> × ${i.q}</li>`).join("");

  // GST invoice → emailed to the payer (works for guests too); admin-only view.
  {
    const { issueOrderInvoice } = await import("@/lib/orderInvoice");
    await issueOrderInvoice({
      razorpayOrderId: order.id,
      payerUserId: (n.userId as string) || null,
      payerName: (n.name as string) || null,
      payerEmail: (n.email as string) || null,
      description: `Books: ${items.map((i) => `${titleById.get(i.b)?.title ?? "Book"} × ${i.q}`).join(", ")}`.slice(0, 180),
      amountInr: order.amount / 100,
      table: "book_orders",
      paymentRef: input.razorpay_payment_id,
    });
  }

  await notifyByEmail({
    studentId: n.userId || null,
    email: n.email || null,
    subject: "📦 Your book order is confirmed",
    html: emailShell(
      "Order confirmed! 🎉",
      `<p>Hi ${n.name || "there"},</p>
       <p>We've received your order:</p><ul>${lines}</ul>
       <p>Total: <strong>₹${(order.amount / 100).toLocaleString("en-IN")}</strong></p>
       <p>It ships soon with free delivery 🚚. Thank you for shopping with us! 📚</p>`,
    ),
    template: "book_ordered",
    payload: { items },
  });

  return { ok: true };
}
