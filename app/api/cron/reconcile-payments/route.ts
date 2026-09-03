import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { reconcileAllStuck } from "@/lib/paymentReconcile";
import { recoverUnrecordedBookOrders } from "@/lib/bookOrderFinish";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// EVERY QUARTER HOUR: finish any paid order the buyer's browser dropped.
//
// There is no Razorpay webhook in this system; enrolment happens in the buyer's
// browser after checkout. This sweep is the safety net under that: any order
// still "created" after ten minutes is checked against Razorpay, and where the
// money is there, the enrolment, invoice and emails are completed exactly as
// the checkout would have done. A paid student can now be unenrolled for at
// most fifteen minutes, whatever happens to anyone's connection.
//
// TWO SWEEPS, BECAUSE THERE ARE TWO WAYS TO LOSE AN ORDER.
//
// The first looks in our tables for a row stuck at "created". That found
// nothing on 2 September, when ₹2,500 for a book set was captured by Razorpay
// and no order existed here at all — because a BOOK order was only ever
// written in the success callback, so a dropped browser leaves no row to be
// stuck. The second sweep therefore runs the other way round: it starts from
// Razorpay's captured payments and asks which of them we have no order for.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await reconcileAllStuck(20);
  const books = await recoverUnrecordedBookOrders(7, 200)
    .catch((e) => ({ checked: 0, recovered: 0, problems: [e instanceof Error ? e.message : "book sweep failed"] }));
  return NextResponse.json({ ok: true, ...r, books });
}
