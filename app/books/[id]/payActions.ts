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
import { toAddress, addressProblems } from "@/lib/address";
import { checkGstin } from "@/lib/gstin";
import type { CheckoutDetails } from "@/app/books/cartActions";

export type BookOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name: string; email: string; contact: string } }
  | { ok: false; reason: "unconfigured" | "oos" | "invalid" | "error"; missing?: string[] };

export async function createBookOrder(input: {
  bookId: string;
  qty: number;
  buyer: CheckoutDetails;
}): Promise<BookOrderResult> {
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };
  const qty = Math.max(1, Math.min(20, Math.floor(input.qty || 1)));
  const d = input.buyer;

  // Same two addresses and the same rules as the cart — one book or ten, the
  // buyer should not meet a different form.
  const billing = toAddress(d?.billing);
  const shipping = d?.shipTo === "different" ? toAddress(d?.shipping) : { ...billing };
  const missing = [
    ...addressProblems(billing, { needPhone: false, indiaOnly: false }).map((m) => `billing: ${m}`),
    ...addressProblems(shipping).map((m) => `delivery: ${m}`),
  ];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d?.email ?? "").trim())) missing.push("an email address for the invoice");
  const gstinRaw = String(d?.gstin ?? "").trim();
  const gst = gstinRaw ? checkGstin(gstinRaw) : null;
  if (gst && !gst.ok) missing.push(`GST number — ${gst.problem}`);
  if (missing.length) return { ok: false, reason: "invalid", missing };

  const supabase = createClient();
  const { data: book } = await supabase
    .from("books")
    .select("id, title, price_inr, stock_qty, is_active")
    .eq("id", input.bookId)
    .maybeSingle();
  if (!book || !book.is_active || book.stock_qty < qty) return { ok: false, reason: "oos" };

  const amountInr = book.price_inr * qty;

  // Link to a logged-in buyer if present; otherwise it's a guest order.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const order = await createRazorpayOrder(amountInr, `book_${Date.now()}`, {
      kind: "book",
      bookId: book.id,
      qty: String(qty),
      price: String(book.price_inr),
      name: shipping.name,
      email: String(d.email).trim(),
      phone: shipping.phone,
      ship: JSON.stringify(shipping),
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
      description: `${book.title} × ${qty}`,
      prefill: { name: shipping.name, email: String(d.email).trim(), contact: shipping.phone },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function verifyBookPayment(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean }> {
  if (
    !(await verifyRazorpaySignature(
      input.razorpay_order_id,
      input.razorpay_payment_id,
      input.razorpay_signature,
    ))
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
  if (n.kind !== "book" || order.status !== "paid") return { ok: false };

  const qty = Number(n.qty) || 1;
  const price = Number(n.price) || 0;
  const ship = toAddress((() => { try { return JSON.parse(n.ship); } catch { return {}; } })());
  const bill = toAddress((() => { try { return JSON.parse(n.bill ?? "{}"); } catch { return {}; } })());
  const gstin = String(n.gstin ?? "").trim();
  // Exactly as the register spells it — never tidied. See lib/gstin.ts.
  const tradeName = String(n.trade ?? "");

  // Service role: guest orders have no auth cookie, so RLS would block them.
  const svc = createServiceClient();
  await svc.from("book_orders").insert({
    student_id: n.userId || null,
    guest_contact: { name: n.name, email: n.email, phone: n.phone },
    items: [{ book_id: n.bookId, qty, price_inr: price }],
    amount_inr: order.amount / 100,
    razorpay_order_id: order.id,
    ship_to: ship,
    bill_to: bill,
    gstin: gstin || null,
    status: "paid",
  });

  // Back to the profile, so it is typed once — see cartActions.verifyCartPayment.
  if (n.userId) {
    const patch: Record<string, unknown> = { shipping_address: ship };
    if (bill.line1 && bill.city) {
      patch.address_line1 = bill.line1;
      patch.address_line2 = bill.line2 || null;
      patch.city = bill.city;
      patch.state = bill.state || null;
      patch.pincode = bill.pincode || null;
    }
    if (gstin) patch.gstin = gstin;
    if (tradeName) { patch.trade_name = tradeName; patch.business_name = tradeName; }
    try { await svc.from("profiles").update(patch).eq("id", n.userId); }
    catch { /* the order stands whatever the profile does */ }
  }

  // Decrement stock (best-effort).
  const { data: book } = await svc
    .from("books")
    .select("stock_qty, title")
    .eq("id", n.bookId)
    .maybeSingle();
  if (book) {
    await svc
      .from("books")
      .update({ stock_qty: Math.max(0, book.stock_qty - qty) })
      .eq("id", n.bookId);
  }

  await notifyByEmail({
    studentId: n.userId || null,
    email: n.email || null,
    subject: "📦 Your book order is confirmed",
    html: emailShell(
      "Order confirmed! 🎉",
      `<p>Hi ${n.name || "there"},</p>
       <p>We've received your order for <strong>${book?.title ?? "your book"} × ${qty}</strong>.</p>
       <p>It ships soon with free delivery 🚚. Thank you for shopping with us! 📚</p>`,
    ),
    template: "book_ordered",
    payload: { bookId: n.bookId, qty },
  });

  return { ok: true };
}
