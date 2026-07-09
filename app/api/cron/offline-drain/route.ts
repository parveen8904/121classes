import { NextResponse, type NextRequest } from "next/server";
import { prepareNextPending } from "@/lib/offlinePrepare";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dedicated offline-classes worker: every 5 minutes, spend up to ~4.5 minutes
// preparing classes (download → encrypt → store → register). Together with the
// in-job lease (a job actively worked in the last 2.5 min is skipped) this
// drains the whole backlog hands-free at roughly 6–10 classes/hour.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let result: unknown = null;
  try { result = await prepareNextPending(275_000); } catch (e) { result = { error: e instanceof Error ? e.message : "failed" }; }
  return NextResponse.json({ ok: true, result });
}
