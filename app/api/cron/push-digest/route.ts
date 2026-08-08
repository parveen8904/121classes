import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { drainPushOutbox, queueStartingSoon } from "@/lib/pushDigest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sends whatever the triggers have recorded since the last run.
//
// Every 15 minutes: often enough that a class posted now is announced while it
// still feels like news, rare enough that several uploads in a row arrive as
// one line rather than a burst.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Queue first, then drain, so a class starting in forty minutes goes out on
  // this run rather than waiting for the next one.
  let queuedSoon = 0;
  try {
    queuedSoon = await queueStartingSoon();
  } catch {
    // A failure here must not stop everything else from being delivered.
  }

  const result = await drainPushOutbox();
  return NextResponse.json({ ok: true, queuedSoon, ...result });
}
