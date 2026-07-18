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
  | { ok: false; reason: "unconfigured" | "oos" | "invalid" | "empty" | "error"; title?: string };

// One Razorpay order for the whole cart. Prices come from the DB — never from
// the client. Items are carried in the order notes and written to book_orders
// after the payment verifies.
export async function createCartOrder(input: { items: { bookId: string; qty: number }[]; buyer: Buyer }): Promise<CartOrderResult> {
  if (!(await razorpayConfigured())) return { ok: false, reason: "unconfigured" };
  const b = input.buyer;
  if (!b?.name || !b?.email || !b?.phone || !b?.line1 || !b?.city || !b?.pincode) return { ok: false, reason: "invalid" };
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

  const ship = { name: b.name, line1: b.line1, line2: b.line2 ?? "", city: b.city, state: b.state, pincode: b.pincode, phone: b.phone };
  const { data: { user } } = await supabase.auth.getUser();

  try {
    const order = await createRazorpayOrder(total, `cart_${Date.now()}`, {
      kind: "book_cart",
      items: JSON.stringify(items),
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
      name: "CA Parveen Sharma — Books",
      description: titles.join(", ").slice(0, 250),
      prefill: { name: b.name, email: b.email, contact: b.phone },
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
  const ship = (() => { try { return JSON.parse(n.ship); } catch { return {}; } })();
  if (!items.length) return { ok: false };

  const svc = createServiceClient();
  await svc.from("book_orders").insert({
    student_id: n.userId || null,
    guest_contact: { name: n.name, email: n.email, phone: n.phone },
    items: items.map((i) => ({ book_id: i.b, qty: i.q, price_inr: i.p })),
    amount_inr: order.amount / 100,
    razorpay_order_id: order.id,
    ship_to: ship,
    status: "paid",
  });

  // Decrement stock per title (best-effort) and gather names for the email.
  const { data: books } = await svc.from("books").select("id, title, stock_qty").in("id", items.map((i) => i.b));
  const titleById = new Map((books ?? []).map((x) => [x.id as string, x]));
  for (const i of items) {
    const bk = titleById.get(i.b);
    if (bk) await svc.from("books").update({ stock_qty: Math.max(0, (bk.stock_qty as number) - i.q) }).eq("id", i.b);
  }
  const lines = items.map((i) => `<li><strong>${titleById.get(i.b)?.title ?? "Book"}</strong> × ${i.q}</li>`).join("");

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
