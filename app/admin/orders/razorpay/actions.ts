"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { recoverUnrecordedBookOrders } from "@/lib/bookOrderFinish";

/**
 * MONEY TAKEN, ORDER MISSING — FIND IT AND FINISH IT.
 *
 * The quarter-hourly cron does this by itself. This button exists because on 3
 * September the team reported a ₹2,500 book payment with no order "on urgent
 * basis", and "wait fifteen minutes" is not an answer anybody should have to
 * give a customer who has already paid.
 *
 * It creates nothing that Razorpay does not already show as captured against
 * an order this checkout raised, and it cannot make the same order twice —
 * see finishBookOrderFromRazorpay.
 */
export async function recoverBookOrdersAction() {
  await assertArea("orders");
  let note: string;
  try {
    const r = await recoverUnrecordedBookOrders(14, 500);
    note = r.recovered > 0
      ? `Recovered ${r.recovered} paid book order${r.recovered === 1 ? "" : "s"} that had no record here — the buyer has been emailed and the invoice raised.`
      : r.checked === 0
        ? "Every captured payment in the last fortnight already has its order. Nothing was missing."
        : `Checked ${r.checked} payment(s) with no order here; none of them was a book checkout, so there was nothing to rebuild.`;
    if (r.problems.length) note += ` Could not finish: ${r.problems.slice(0, 3).join("; ")}`;
  } catch (e) {
    note = `The sweep could not run: ${e instanceof Error ? e.message : "unknown"}`;
  }
  revalidatePath("/admin/orders/razorpay");
  redirect(`/admin/orders/razorpay?scan=${encodeURIComponent(note)}`);
}
