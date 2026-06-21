import { NextResponse, type NextRequest } from "next/server";
import { ingestGovtFeeds, sendFeedDigest } from "@/lib/govtfeed";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HOURLY cron (Vercel) — pulls new CA / accounting-standards news from the
// keyword feeds into PENDING announcements, then emails the founder a digest of
// just what was found this hour so he can approve from his phone. Deduped by
// link, so an hour with nothing new sends no email.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await ingestGovtFeeds();
  if (result.items.length) await sendFeedDigest(result.items);
  return NextResponse.json({ ok: true, added: result.added, checked: result.checked });
}
