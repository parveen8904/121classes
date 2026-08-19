import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { reconcileAllStuck } from "@/lib/paymentReconcile";

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
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await reconcileAllStuck(20);
  return NextResponse.json({ ok: true, ...r });
}
