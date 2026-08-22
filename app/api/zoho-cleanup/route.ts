import { NextResponse, type NextRequest } from "next/server";
import { zohoFetch } from "@/lib/zohoApi";

export const dynamic = "force-dynamic";

// ONE-TIME CLEANUP — deletes the redundant "Razorpay Clearing (AI)" account
// (id 1524041000016322002, zero transactions, machine-created 22 Aug) now that
// the team's existing "Razorpay Clearing" is confirmed as the deposit target.
// Guarded by a single-use token; this file is removed right after it runs.
const ONE_TIME_TOKEN = "zc-9f41c6e2b8d34a7f-once";
const TARGET_ACCOUNT_ID = "1524041000016322002";

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("t") !== ONE_TIME_TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const r = await zohoFetch<{ message?: string }>(`/chartofaccounts/${TARGET_ACCOUNT_ID}`, { method: "DELETE" });
    return NextResponse.json({ ok: true, message: r.message ?? "deleted" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
