import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { drainQueued } from "@/lib/zohoApprovals";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// FINISH WHAT HE ALREADY APPROVED.
//
// Zoho allows the organisation 100 API calls a minute and a posting costs
// several, so releasing a long queue cannot complete in one go. Until now the
// remainder waited for him to press approve again — the system asking him to do
// its waiting for it. Anything he released that did not fit is now held as
// `queued`, and this empties that queue a minute at a time.
//
// IT DECIDES NOTHING. A row only reaches `queued` from a release he performed
// himself, it carries his name and the moment he decided, and it posts through
// the same releaseApproval path behind the same guard. Nothing new can enter
// the queue except by his hand.
//
// It stops the instant Zoho throttles rather than pushing against the limit:
// what is left simply goes in the next run, so a backlog of any size clears
// itself.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const r = await drainQueued();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    // Loud: a drain that fails quietly is a queue that never empties, and he
    // would be waiting for postings that are never coming.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
