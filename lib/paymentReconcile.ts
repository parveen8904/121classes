import { createServiceClient } from "@/lib/supabase/service";
import { fetchRazorpayOrder, fetchRazorpayOrderPayments } from "@/lib/razorpay";

// FINISH WHAT THE BROWSER DROPPED.
//
// There is no Razorpay webhook anywhere in this system. Every enrolment happens
// in the BUYER'S browser, in the half-second after checkout — and when that
// half-second is lost to a dropped connection or a closed tab, the money is
// with Razorpay, the order sits at "created" for ever, and the student is never
// enrolled. That is the vendor complaint of 19 August, exactly.
//
// This asks Razorpay directly — did this order get paid? — and if so, finishes
// the job server-side: enrolment, invoice, emails, all through the same code
// the checkout callback uses. Called three ways: the admin's manual confirm
// (with the payment id typed in), and the quarter-hourly sweep over stuck rows.
//
// ON THE INVOICE SERIAL, because accounts asked: the number is allocated at the
// moment the invoice is ISSUED — here, at confirmation — taking the next number
// in the running series. It is never reused and never backdated; the sequence
// stays unbroken. The invoice date is the confirmation date, so an order paid
// on Friday and confirmed on Monday carries Monday's date against Friday's
// payment reference. That is the honest paper trail of what happened.

export type ReconcileResult = { ok: boolean; did?: string; reason?: string };

export async function reconcileStuckPayment(
  table: "orders" | "gift_orders",
  id: string,
  opts: { paymentId?: string } = {},
): Promise<ReconcileResult> {
  const svc = createServiceClient();
  const { data: row } = await svc.from(table).select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, reason: "order not found" };
  const status = String((row as { status?: string }).status ?? "");
  if (table === "orders" && ["paid", "provisioned"].includes(status)) return { ok: false, reason: "already paid" };
  if (table === "gift_orders" && status === "provisioned") return { ok: false, reason: "already provisioned" };

  const rzpOrderId = String((row as { razorpay_order_id?: string }).razorpay_order_id ?? "");
  if (!rzpOrderId) return { ok: false, reason: "no Razorpay order behind this row" };

  // THE MONEY, FROM RAZORPAY'S MOUTH. Never from a typed field alone: the
  // payment id the admin enters must belong to THIS order and be captured, or a
  // typo would enrol somebody against somebody else's money.
  let order;
  try { order = await fetchRazorpayOrder(rzpOrderId); } catch { return { ok: false, reason: "could not reach Razorpay" }; }
  if (order.status !== "paid") return { ok: false, reason: `Razorpay says this order is "${order.status}", not paid — nothing confirmed` };

  let payments: Awaited<ReturnType<typeof fetchRazorpayOrderPayments>> = [];
  try { payments = await fetchRazorpayOrderPayments(rzpOrderId); } catch { /* verified via order.status above */ }
  const captured = payments.filter((p) => (p as { status?: string }).status === "captured");
  let paymentId = opts.paymentId?.trim() || "";
  if (paymentId) {
    if (!captured.some((p) => (p as { id?: string }).id === paymentId)) {
      return { ok: false, reason: "that payment id does not match a captured payment on this order — check it" };
    }
  } else {
    paymentId = String((captured[0] as { id?: string } | undefined)?.id ?? "");
  }
  if (!paymentId) return { ok: false, reason: "no captured payment found on the order" };

  if (table === "gift_orders") {
    const { data: gifter } = await svc.from("profiles").select("email")
      .eq("id", (row as { gifter_id?: string }).gifter_id ?? "").maybeSingle();
    const { provisionPaidGiftOrder } = await import("@/lib/giftProvision");
    await provisionPaidGiftOrder(row as never, paymentId, {
      gifterEmail: (gifter?.email as string) ?? null,
      couponId: (order.notes as { couponId?: string } | undefined)?.couponId ?? null,
    });
    return { ok: true, did: "student enrolled, invoice raised and emailed" };
  }

  // orders — the site's own subscription sales. Provisioning data lives in the
  // Razorpay order NOTES, written when checkout began, so the server needs
  // nothing from the buyer.
  const n = (order.notes ?? {}) as Record<string, string>;
  if (n.kind === "subscription") {
    const months = Number(n.months) || 12;
    // The same end-date arithmetic the checkout callback uses — a live batch
    // expires after its classes, not on the calendar.
    let endsAt: string;
    try {
      const { subscriptionEnd } = await import("@/lib/planWindow");
      const { batchWindow } = await import("@/lib/batchWindow");
      const w = await batchWindow(svc, n.subjectId ?? null);
      endsAt = subscriptionEnd(new Date(), months, w).toISOString();
    } catch {
      endsAt = new Date(Date.now() + months * 30 * 864e5).toISOString();
    }
    await svc.from("subscriptions").insert({
      student_id: n.userId,
      course_id: n.courseId,
      subject_id: n.subjectId ?? null,
      plan_id: n.planId,
      channel: "web",
      ends_at: endsAt,
      status: "active",
      auto_renew: true,
      months_total: months,
    });
    if (n.courseId) await svc.from("my_courses").upsert({ student_id: n.userId, course_id: n.courseId }, { onConflict: "student_id,course_id" });
    if (n.subjectId) await svc.from("my_subjects").upsert({ student_id: n.userId, subject_id: n.subjectId }, { onConflict: "student_id,subject_id" });
    await svc.from(table).update({ status: "paid", store_txn_id: paymentId }).eq("id", id);
    if (n.couponId) {
      const { redeemCoupon } = await import("@/lib/coupons");
      await redeemCoupon(n.couponId).catch(() => undefined);
    }

    // The invoice — allocated its serial NOW, the next in the series, and
    // emailed by the same code every automatic invoice uses.
    const { data: full } = await svc.from("orders")
      .select("razorpay_order_id, student_id, amount_inr, kind, subjects:subject_id(title), profiles:student_id(full_name, email)")
      .eq("id", id).maybeSingle();
    if (full) {
      const { issueOrderInvoice } = await import("@/lib/orderInvoice");
      await issueOrderInvoice({
        razorpayOrderId: rzpOrderId,
        payerUserId: (full as { student_id: string }).student_id,
        payerName: (full as { profiles?: { full_name?: string } }).profiles?.full_name ?? null,
        payerEmail: (full as { profiles?: { email?: string } }).profiles?.email ?? null,
        description: `Coaching: ${(full as { subjects?: { title?: string } }).subjects?.title ?? "Online classes"} — ${(full as { kind?: string }).kind ?? "subscription"}`,
        amountInr: Number((full as { amount_inr?: number }).amount_inr) || 0,
        table: "orders",
        paymentRef: paymentId,
      }).catch(() => undefined);
    }
    return { ok: true, did: "subscription granted, invoice raised and emailed" };
  }

  // An extension order carries different arithmetic (months added to a running
  // subscription). Rather than guess at it, say so — these are rare and the
  // admin can extend from the user page while the money shows verified.
  return { ok: false, reason: `this is a "${n.kind || "?"}" order — money IS verified at Razorpay; extend/grant it from the student's admin page and note the payment id ${paymentId}` };
}

/** The quarter-hourly sweep: finish every stuck order that Razorpay says is paid. */
export async function reconcileAllStuck(limit = 20): Promise<{ checked: number; fixed: number }> {
  const svc = createServiceClient();
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const until = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // give checkout its half-minute
  let checked = 0, fixed = 0;

  const { data: stuckOrders } = await svc.from("orders")
    .select("id").eq("status", "created").not("razorpay_order_id", "is", null)
    .gte("created_at", since).lte("created_at", until).limit(limit);
  for (const r of stuckOrders ?? []) {
    checked++;
    const res = await reconcileStuckPayment("orders", String(r.id));
    if (res.ok) fixed++;
  }
  const { data: stuckGifts } = await svc.from("gift_orders")
    .select("id").eq("status", "created").not("razorpay_order_id", "is", null)
    .gte("created_at", since).lte("created_at", until).limit(limit);
  for (const r of stuckGifts ?? []) {
    checked++;
    const res = await reconcileStuckPayment("gift_orders", String(r.id));
    if (res.ok) fixed++;
  }
  return { checked, fixed };
}
