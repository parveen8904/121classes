import { NextResponse, type NextRequest } from "next/server";
import { ingestJobs, sendPlacementDigest } from "@/lib/jobsfeed";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // was 60 — the jobs sweep timed out 4x this month

// DAILY cron — placement jobs digest + cost alerts. (The govt/ICAI news feed
// runs hourly in /api/cron/feed-hourly so new items reach the founder fast.)
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const jobs = await ingestJobs();
  if (jobs.items?.length) await sendPlacementDigest(jobs.items);
  const { maybeBunnyAlert } = await import("@/lib/bunny");
  await maybeBunnyAlert();
  const { maybeStorageAlert } = await import("@/lib/costalerts");
  await maybeStorageAlert();
  const { runDailyTargets } = await import("@/lib/dailyTargets");
  const targets = await runDailyTargets();
  return NextResponse.json({ ok: true, jobs: { added: jobs.added, checked: jobs.checked }, dailyTargets: targets.sent });
}
