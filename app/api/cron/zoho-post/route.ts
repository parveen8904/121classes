import { NextResponse, type NextRequest } from "next/server";
import { zohoConfigured } from "@/lib/zoho";
import { queueApprovedSales } from "@/lib/websiteSales";

export const dynamic = "force-dynamic";

// NIGHTLY: PUT APPROVED WEBSITE SALES IN FRONT OF HIM — and post none of them.
//
// This used to write straight into Zoho at half past three in the morning, with
// nobody's approval. That is the one thing he has said must never happen, and
// it is also how a run of customers appeared in his books overnight with no
// staff awake to have made them: each nightly retry created the customer, the
// invoice leg then failed, and the reason went only to the server log.
//
// Now it prepares and asks. Everything waits at his gate until he releases it,
// and a sale already waiting is not queued twice.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const qp = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && qp !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  if (!(await zohoConfigured())) {
    return NextResponse.json({ ok: true, skipped: "Zoho keys not configured yet" });
  }

  try {
    const { queued, already } = await queueApprovedSales();
    return NextResponse.json({ ok: true, queued, already, posted: 0, note: "nothing is posted without his approval" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
