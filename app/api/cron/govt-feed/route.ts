import { NextResponse, type NextRequest } from "next/server";
import { ingestGovtFeeds } from "@/lib/govtfeed";
import { ingestJobs, sendPlacementDigest } from "@/lib/jobsfeed";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Scheduled (Vercel cron) + safe to call manually. Pulls new govt/ICAI feed
// items into PENDING announcements for faculty approval.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await ingestGovtFeeds();
  const jobs = await ingestJobs();
  if (jobs.items?.length) await sendPlacementDigest(jobs.items);
  const { maybeBunnyAlert } = await import("@/lib/bunny");
  await maybeBunnyAlert();
  return NextResponse.json({ ok: true, feeds: result, jobs: { added: jobs.added, checked: jobs.checked } });
}
