"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  razorpayConfigured,
  razorpayKeyId,
  createRazorpayOrder,
  verifyRazorpaySignature,
} from "@/lib/razorpay";
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
  // One implementation for both doors — see lib/bookOrderFinish.ts and the
  // note in cartActions. This one also gains the tax invoice it never issued:
  // a buyer's right to one does not depend on which button they pressed.
  const { finishBookOrderFromRazorpay } = await import("@/lib/bookOrderFinish");
  const r = await finishBookOrderFromRazorpay(input.razorpay_order_id, input.razorpay_payment_id);
  return { ok: r.ok };
}
