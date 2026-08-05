import { NextResponse, type NextRequest } from "next/server";
import { prepareNextPending, queueSmallerQualities } from "@/lib/offlinePrepare";
import { getSecret } from "@/lib/secrets";
import { isOffPeakNow } from "@/lib/offpeak";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dedicated offline-classes worker: every 5 minutes it spends up to ~4.5 minutes
// preparing classes (download → encrypt → store → register). Encryption is heavy
// (CPU + bandwidth + DB), so it runs ONLY in the quiet overnight window — during
// the busy day/evening it returns immediately and does nothing. Overnight it
// still drains the whole backlog hands-free (~6–10 classes/hour) via the in-job
// lease. ?force=1 lets an admin run it on demand.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isOffPeakNow() && new URL(req.url).searchParams.get("force") !== "1") {
    return NextResponse.json({ ok: true, result: "skipped-peak" });
  }
  // Make sure the smaller sizes are on the queue before draining it. Every
  // class was prepared at 720p only, so the quality choice on the student's
  // screen had exactly one option; this fills in 480p and 360p a batch at a
  // time. It only ever adds what is missing, so it is safe on every pass.
  let queued: unknown = null;
  try { queued = await queueSmallerQualities(40); } catch (e) { queued = { error: e instanceof Error ? e.message : "failed" }; }

  let result: unknown = null;
  try { result = await prepareNextPending(255_000); } catch (e) { result = { error: e instanceof Error ? e.message : "failed" }; }
  return NextResponse.json({ ok: true, queued, result });
}
