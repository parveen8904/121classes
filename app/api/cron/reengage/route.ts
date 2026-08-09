import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { runReengagement } from "@/lib/reengage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Nightly. The work itself lives in lib/reengage.ts so the admin button can run
// exactly the same thing rather than a second copy that drifts.
export async function GET(request: NextRequest) {
  const secret = (await getSecret("CRON_SECRET")) || process.env.CRON_SECRET || "";
  if (secret) {
    const auth = request.headers.get("authorization");
    const qp = request.nextUrl.searchParams.get("secret") ?? request.nextUrl.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && qp !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  return NextResponse.json(await runReengagement());
}
