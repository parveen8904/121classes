import { createServiceClient } from "@/lib/supabase/service";
import { fetchRazorpayOrder } from "@/lib/razorpay";
import { notifyByEmail, emailShell } from "@/lib/notify";
import { toAddress } from "@/lib/address";

// A BOOK ORDER THAT EXISTS EVEN WHEN THE BROWSER DOES NOT.
//
// 3 September 2026, from the team: "Payment received on razorpay but order not
// created on our website, kindly check and resolve on urgent basis." — a
// ₹2,500 CA Final FR book set, paid on 2 September, captured by Razorpay, and
// nowhere in this database at all.
//
// The cause is structural, not a fluke. A subscription order or a gift is
// written to our tables at "created" BEFORE the buyer is sent to Razorpay, so
// when the browser dies mid-payment there is a row to find and finish — which
// is what lib/paymentReconcile.ts sweeps for. A BOOK order was different: the
// row was written only in the success callback, in the buyer's browser, after
// the money had moved. Lose that half-second — a closed tab, a dropped train
// connection, a UPI app that does not come back — and the money is with
// Razorpay while nothing whatsoever exists here. There is no stuck row to
// find, because there is no row.
//
// Everything needed to build the order is on the Razorpay order's notes: what
// was bought, for how much, by whom, where it ships and what it bills to. So
// this reconstructs it from Razorpay — the same work the callback does, in the
// same order, by the same code — and it is now the ONLY implementation. The
// callbacks call it too, so a recovered order and a normal one cannot drift.
//
// Idempotent by the Razorpay order id: a second call, from a refreshed
// callback or from the sweep arriving at the same moment, finds the row and
// does nothing. Before this the callback inserted unconditionally, so a
// double-submit would have made two orders and two invoices for one payment.

export type FinishResult =
  | { ok: true; created: true; orderId: string }
  | { ok: true; created: false; why: "already recorded" }
  | { ok: false; why: string };

/**
 * Turn a paid Razorpay order into a book order, once.
 *
 * `paymentId` is recorded against the order and used as the invoice's payment
 * reference. The caller has already established that the money is real —
 * either by verifying the checkout signature, or by reading a captured payment
 * off Razorpay's own list.
 */
export async function finishBookOrderFromRazorpay(
  rzpOrderId: string,
  paymentId: string,
): Promise<FinishResult> {
  const svc = createServiceClient();

  // ALREADY DONE? Ask first, and ask by the one thing that is unique per
  // payment — the Razorpay order id.
  const { data: existing } = await svc.from("book_orders")
    .select("id").eq("razorpay_order_id", rzpOrderId).maybeSingle();
  if (existing) return { ok: true, created: false, why: "already recorded" };

  let order;
  try { order = await fetchRazorpayOrder(rzpOrderId); }
  catch { return { ok: false, why: "could not reach Razorpay" }; }
  if (order.status !== "paid") return { ok: false, why: `Razorpay says that order is "${order.status}", not paid` };

  const n = (order.notes ?? {}) as Record<string, string>;
  const kind = String(n.kind ?? "");
  if (kind !== "book" && kind !== "book_cart") return { ok: false, why: "not a book order" };

  const parse = <T,>(raw: string | undefined, fallback: T): T => {
    try { return JSON.parse(String(raw ?? "")) as T; } catch { return fallback; }
  };
  const ship = toAddress(parse<Record<string, unknown>>(n.ship, {}));
  const bill = toAddress(parse<Record<string, unknown>>(n.bill, {}));
  const gstin = String(n.gstin ?? "").trim();
  // Exactly as the register spells it — never tidied. See lib/gstin.ts.
  const tradeName = String(n.trade ?? "");
  const amountInr = order.amount / 100;

  // One shape for both kinds. A single-book order is a cart of one, and every
  // step below then stops caring which door the buyer came through.
  const items: { b: string; q: number; p: number }[] = kind === "book_cart"
    ? parse<{ b: string; q: number; p: number }[]>(n.items, [])
    : [{ b: String(n.bookId ?? ""), q: Number(n.qty) || 1, p: Number(n.price) || 0 }];
  if (!items.length || !items[0].b) return { ok: false, why: "the Razorpay order carries no items" };

  const { data: made, error } = await svc.from("book_orders").insert({
    student_id: n.userId || null,
    guest_contact: { name: n.name, email: n.email, phone: n.phone },
    items: items.map((i) => ({ book_id: i.b, qty: i.q, price_inr: i.p })),
    amount_inr: amountInr,
    razorpay_order_id: order.id,
    razorpay_payment_id: paymentId || null,
    ship_to: ship,
    // Frozen at the order. The profile may be edited tomorrow; an invoice must
    // keep saying what it said on the day.
    bill_to: bill,
    gstin: gstin || null,
    status: "paid",
  }).select("id").single();

  if (error || !made) {
    // A unique violation here means the sweep and the callback met on the same
    // order. That is a success, not a failure — the order exists.
    if (error && /duplicate key/i.test(error.message)) {
      return { ok: true, created: false, why: "already recorded" };
    }
    return { ok: false, why: error?.message ?? "the order could not be written" };
  }

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
    if (tradeName) { patch.trade_name = tradeName; patch.business_name = tradeName; }
    try { await svc.from("profiles").update(patch).eq("id", n.userId); }
    catch { /* the order stands whatever the profile does */ }
  }

  // Stock, per title (best-effort).
  const { data: books } = await svc.from("books")
    .select("id, title, stock_qty").in("id", items.map((i) => i.b));
  const byId = new Map((books ?? []).map((x) => [String(x.id), x as { title: string; stock_qty: number }]));
  for (const i of items) {
    const bk = byId.get(i.b);
    if (bk) await svc.from("books").update({ stock_qty: Math.max(0, bk.stock_qty - i.q) }).eq("id", i.b);
  }
  const titled = items.map((i) => `${byId.get(i.b)?.title ?? "Book"} × ${i.q}`);

  // GST invoice → emailed to the payer (works for guests too); admin-only view.
  //
  // The single-book door never issued one; only the cart did. A buyer's right
  // to a tax invoice does not depend on which button they pressed, and an
  // invoice missing from the series is a hole in the register.
  try {
    const { issueOrderInvoice } = await import("@/lib/orderInvoice");
    await issueOrderInvoice({
      razorpayOrderId: order.id,
      payerUserId: (n.userId as string) || null,
      payerName: (n.name as string) || null,
      payerEmail: (n.email as string) || null,
      description: `Books: ${titled.join(", ")}`.slice(0, 180),
      amountInr,
      table: "book_orders",
      paymentRef: paymentId,
    });
  } catch { /* the order and the money stand whatever the invoice does */ }

  await notifyByEmail({
    studentId: n.userId || null,
    email: n.email || null,
    subject: "📦 Your book order is confirmed",
    html: emailShell(
      "Order confirmed! 🎉",
      `<p>Hi ${n.name || "there"},</p>
       <p>We&rsquo;ve received your order:</p><ul>${
         items.map((i) => `<li><strong>${byId.get(i.b)?.title ?? "Book"}</strong> × ${i.q}</li>`).join("")
       }</ul>
       <p>Total: <strong>₹${amountInr.toLocaleString("en-IN")}</strong></p>
       <p>It ships soon with free delivery 🚚. Thank you for shopping with us! 📚</p>`,
    ),
    template: "book_ordered",
    payload: { items },
  });

  return { ok: true, created: true, orderId: String(made.id) };
}

/**
 * MONEY WITH NO ORDER BEHIND IT.
 *
 * lib/paymentReconcile.ts sweeps rows stuck at "created". A dropped book
 * checkout leaves no row to be stuck, so that sweep can never see it — it is
 * looking in this database for something that only exists at Razorpay.
 *
 * So this sweep runs the other way round: it starts from Razorpay's captured
 * payments, and asks of each one whether we have the order. Anything that is a
 * book order and is not here gets finished.
 *
 * Deliberately narrow. It only touches payments whose Razorpay ORDER carries
 * our own `kind: book | book_cart` note — money taken through a payment link, a
 * QR code or anything else outside this checkout has no order to reconstruct
 * and is left alone rather than guessed at.
 */
export async function recoverUnrecordedBookOrders(
  days = 7,
  max = 200,
): Promise<{ checked: number; recovered: number; problems: string[] }> {
  const svc = createServiceClient();
  const { listRazorpayPayments } = await import("@/lib/razorpay");

  let payments: Awaited<ReturnType<typeof listRazorpayPayments>>["payments"] = [];
  try { ({ payments } = await listRazorpayPayments(days, max)); }
  catch (e) { return { checked: 0, recovered: 0, problems: [e instanceof Error ? e.message : "could not list payments"] }; }

  // Captured only, and only those Razorpay attached to an order of ours. The
  // failed twin of a retried payment — the ₹2,500 that shows beside the good
  // one — must never produce an order.
  const candidates = payments.filter((p) => p.status === "captured" && p.order_id);
  if (!candidates.length) return { checked: 0, recovered: 0, problems: [] };

  // One query for the lot, rather than one per payment.
  const orderIds = [...new Set(candidates.map((p) => String(p.order_id)))];
  const known = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const slice = orderIds.slice(i, i + 200);
    const [{ data: b }, { data: o }, { data: g }] = await Promise.all([
      svc.from("book_orders").select("razorpay_order_id").in("razorpay_order_id", slice),
      svc.from("orders").select("razorpay_order_id").in("razorpay_order_id", slice),
      svc.from("gift_orders").select("razorpay_order_id").in("razorpay_order_id", slice),
    ]);
    for (const r of [...(b ?? []), ...(o ?? []), ...(g ?? [])]) {
      const v = (r as { razorpay_order_id?: string }).razorpay_order_id;
      if (v) known.add(String(v));
    }
  }

  const missing = candidates.filter((p) => !known.has(String(p.order_id)));
  let recovered = 0;
  const problems: string[] = [];
  for (const p of missing) {
    const r = await finishBookOrderFromRazorpay(String(p.order_id), String(p.id));
    if (r.ok && r.created) recovered++;
    // "not a book order" is the ordinary case for a subscription paid outside
    // this flow, and saying so on every sweep would bury the real ones.
    else if (!r.ok && r.why !== "not a book order") {
      problems.push(`${p.id} (${p.email ?? "no email"}, ₹${(p.amount / 100).toLocaleString("en-IN")}): ${r.why}`);
    }
  }
  return { checked: missing.length, recovered, problems };
}
