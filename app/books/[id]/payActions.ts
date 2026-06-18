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

type Buyer = {
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
};

export type BookOrderResult =
  | { ok: true; orderId: string; amount: number; keyId: string; name: string; description: string; prefill: { name: string; email: string; contact: string } }
  | { ok: false; reason: "unconfigured" | "oos" | "invalid" | "error" };

export async function createBookOrder(input: {
  bookId: string;
  qty: number;
  buyer: Buyer;
}): Promise<BookOrderResult> {
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };
  const qty = Math.max(1, Math.min(20, Math.floor(input.qty || 1)));
  const b = input.buyer;
  if (!b?.name || !b?.email || !b?.phone || !b?.line1 || !b?.city || !b?.pincode) {
    return { ok: false, reason: "invalid" };
  }

  const supabase = createClient();
  const { data: book } = await supabase
    .from("books")
    .select("id, title, price_inr, stock_qty, is_active")
    .eq("id", input.bookId)
    .maybeSingle();
  if (!book || !book.is_active || book.stock_qty < qty) return { ok: false, reason: "oos" };

  const amountInr = book.price_inr * qty;
  const ship = {
    name: b.name,
    line1: b.line1,
    line2: b.line2 ?? "",
    city: b.city,
    state: b.state,
    pincode: b.pincode,
    phone: b.phone,
  };

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
      name: b.name,
      email: b.email,
      phone: b.phone,
      ship: JSON.stringify(ship),
      userId: user?.id ?? "",
    });
    return {
      ok: true,
      orderId: order.id,
      amount: order.amount,
      keyId: await razorpayKeyId(),
      name: "121 CA Classes — Books",
      description: `${book.title} × ${qty}`,
      prefill: { name: b.name, email: b.email, contact: b.phone },
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
  const ship = (() => {
    try {
      return JSON.parse(n.ship);
    } catch {
      return {};
    }
  })();

  // Service role: guest orders have no auth cookie, so RLS would block them.
  const svc = createServiceClient();
  await svc.from("book_orders").insert({
    student_id: n.userId || null,
    guest_contact: { name: n.name, email: n.email, phone: n.phone },
    items: [{ book_id: n.bookId, qty, price_inr: price }],
    amount_inr: order.amount / 100,
    razorpay_order_id: order.id,
    ship_to: ship,
    status: "paid",
  });

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
