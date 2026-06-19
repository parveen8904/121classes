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

  // Temporary diagnostic: /api/cron/govt-feed?probe=1 — checks whether the
  // server can read the Jooble key and reach the Jooble API.
  if (new URL(req.url).searchParams.get("probe") === "1") {
    const key = await getSecret("JOOBLE_API_KEY");
    let status = 0, count = -1, err = "";
    if (key) {
      try {
        const r = await fetch(`https://jooble.org/api/${key}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keywords: "Chartered Accountant", location: "India" }),
          cache: "no-store",
        });
        status = r.status;
        const d = await r.json().catch(() => ({}));
        count = Array.isArray(d.jobs) ? d.jobs.length : -2;
      } catch (e) {
        err = String(e).slice(0, 200);
      }
    }
    return NextResponse.json({ keySet: !!key, keyLen: key.length, joobleStatus: status, joobleCount: count, err });
  }

  const result = await ingestGovtFeeds();
  const jobs = await ingestJobs();
  if (jobs.items?.length) await sendPlacementDigest(jobs.items);
  return NextResponse.json({ ok: true, feeds: result, jobs: { added: jobs.added, checked: jobs.checked } });
}
