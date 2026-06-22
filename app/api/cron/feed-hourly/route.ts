import { NextResponse, type NextRequest } from "next/server";
import { ingestGovtFeeds, maybeSendDailyFeedDigest } from "@/lib/govtfeed";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Runs hourly (Vercel cron + GitHub Action). It pulls new CA / accounting-
// standards news into PENDING announcements every hour, but emails the founder
// only ONCE every ~24 hours — a single digest of everything found that day, so
// his inbox stays simple. Deduped by link. Only auto-pulled feed items are ever
// emailed; manually added announcements are untouched.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await ingestGovtFeeds();
  const digest = await maybeSendDailyFeedDigest();
  return NextResponse.json({ ok: true, added: result.added, checked: result.checked, emailed: digest.sent });
}
