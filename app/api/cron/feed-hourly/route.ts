import { NextResponse, type NextRequest } from "next/server";
import { ingestGovtFeeds, maybeSendDailyFeedDigest } from "@/lib/govtfeed";
import { prepareNextPending } from "@/lib/offlinePrepare";
import { syncClassDurations } from "@/lib/syncDurations";
import { resequenceSubjectClasses } from "@/app/admin/topics/[topicId]/actions";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  // ?resequence=1 → re-run class numbering for every subject (idempotent;
  // used after a numbering-rule change so it applies without touching content).
  if (new URL(req.url).searchParams.get("resequence")) {
    const svc = createServiceClient();
    const { data: subs } = await svc.from("subjects").select("id");
    for (const s of subs ?? []) await resequenceSubjectClasses(s.id as string);
    return NextResponse.json({ ok: true, resequenced: (subs ?? []).length });
  }

  const result = await ingestGovtFeeds();
  const digest = await maybeSendDailyFeedDigest();
  // Piggyback: continue one offline-class encryption job per hour (drains the
  // Prepare-all backlog automatically even if the admin closes the page).
  let offline: unknown = null;
  try { offline = await prepareNextPending(120_000); } catch { /* never block the feed */ }
  // Keep class durations true to Bunny's encoded length (drives the ⏱️ shown to
  // students and the ≤100-min part numbering). No-op once everything is synced.
  let durations: unknown = null;
  try { durations = await syncClassDurations(120); } catch { /* never block the feed */ }
  // Pre-digest transcripts into clean saved notes so doubts answer cheaply from
  // the digest instead of re-sending the raw transcript. No-op once all done.
  let knowledge: unknown = null;
  try { const { digestPendingClasses } = await import("@/lib/knowledge"); knowledge = await digestPendingClasses(4); } catch { /* never block the feed */ }
  return NextResponse.json({ ok: true, added: result.added, checked: result.checked, emailed: digest.sent, offline, durations, knowledge });
}
