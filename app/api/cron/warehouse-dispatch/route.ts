import { NextResponse, type NextRequest } from "next/server";
import { runWarehouseDispatch } from "@/lib/warehouse";

export const dynamic = "force-dynamic";

// Daily end-of-day dispatch list to the warehouse. Secured by CRON_SECRET
// (Vercel Cron sends it as a Bearer token); also accepts ?secret= for manual runs.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const qp = request.nextUrl.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && qp !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await runWarehouseDispatch();
  return NextResponse.json(result);
}
