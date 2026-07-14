import { NextResponse, type NextRequest } from "next/server";
import { processPendingCaseSets } from "@/lib/caseStudies";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Works through every case-study PDF still parsing, in ~4-minute bites. If work
// remains when the clock runs low, it triggers ITSELF again (fire-and-forget),
// so a 150-page upload finishes hands-free in a few chained invocations.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processPendingCaseSets(240_000);
  if (result.pending > 0) {
    // Self-chain: start the next invocation and abandon the connection — the
    // target function keeps running server-side after we abort.
    try {
      const url = new URL(req.url);
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 1500);
      await fetch(`${url.origin}/api/case-parse${secret ? `?key=${encodeURIComponent(secret)}` : ""}`, { signal: ac.signal, cache: "no-store" }).catch(() => null);
      clearTimeout(t);
    } catch { /* next hourly cron continues anyway */ }
  }
  return NextResponse.json({ ok: true, ...result });
}
