import { NextResponse, type NextRequest } from "next/server";
import { ingestGovtFeeds, maybeSendDailyFeedDigest } from "@/lib/govtfeed";
import { prepareNextPending } from "@/lib/offlinePrepare";
import { syncClassDurations } from "@/lib/syncDurations";
import { resequenceSubjectClasses } from "@/app/admin/topics/[topicId]/actions";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { isOffPeakNow } from "@/lib/offpeak";

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

  // Light work runs every hour for freshness: pull news, email the daily digest.
  const result = await ingestGovtFeeds();
  const digest = await maybeSendDailyFeedDigest();

  // Daily "what's missing" digest to staff (~09:30 IST = 04:00 UTC run): every
  // forgotten upload — transcripts, notes, revision videos, books, RTP/MTP,
  // tests, MIQ lists — flagged before students notice. Once per day.
  let gapDigest: unknown = null;
  try {
    if (new Date().getUTCHours() === 4) {
      const svc = createServiceClient();
      const today = new Date().toISOString().slice(0, 10);
      const { data: last } = await svc.from("site_settings").select("value").eq("key", "gap_digest_last").maybeSingle();
      if (last?.value !== today) {
        const { buildContentGapReport, gapReportToText } = await import("@/lib/contentGaps");
        const report = await buildContentGapReport();
        if (report.totalGaps > 0) {
          const { notifyFaculty } = await import("@/lib/notify");
          await notifyFaculty(`Content check: ${report.totalGaps} missing items`, gapReportToText(report));
        }
        await svc.from("site_settings").upsert({ key: "gap_digest_last", value: today }, { onConflict: "key" });
        gapDigest = report.totalGaps;
      }
    }
  } catch { /* never block the feed */ }

  // Safety net for admin-initiated case-study PDF parsing: if the self-chaining
  // parser was interrupted, continue it here (cheap check when nothing pending;
  // runs any hour — the admin is waiting on it, and it's one set at a time).
  let cases: unknown = null;
  try {
    const { processPendingCaseSets } = await import("@/lib/caseStudies");
    cases = await processPendingCaseSets(90_000);
  } catch { /* never block the feed */ }

  // Heavy work (video encryption, duration sync, transcript OCR/digest) is
  // DB- and CPU-hungry, so it runs ONLY in the quiet overnight window — never
  // while ~200–1000 students are viewing classes. Off-peak it catches up fast;
  // ?force=1 lets an admin run it on demand. This is the main fix for the
  // recurring "every second day" slowdowns.
  const heavy = isOffPeakNow() || new URL(req.url).searchParams.get("force") === "1";
  let offline: unknown = heavy ? null : "skipped-peak";
  let durations: unknown = heavy ? null : "skipped-peak";
  let knowledge: unknown = heavy ? null : "skipped-peak";
  if (heavy) {
    // Continue one offline-class encryption job (drains the Prepare-all backlog
    // hands-free even if the admin closes the page).
    try { offline = await prepareNextPending(120_000); } catch { /* never block the feed */ }
    // Keep class durations true to Bunny's encoded length. No-op once synced.
    try { durations = await syncClassDurations(120); } catch { /* never block the feed */ }
    // Pre-digest transcripts into clean saved notes so doubts answer cheaply.
    // Bigger batches: this only runs in the quiet overnight window (3 runs), so
    // the backlog (e.g. 269 handwritten notes) clears in nights, not months.
    // Haiku is cheap + fast (founder: process the repository tonight regardless
    // of cost), so digest a big batch each off-peak run — the backlog (e.g. 156
    // FR transcripts) clears in one night. Ingest is resumable if a run is cut short.
    try { const { ingestPending } = await import("@/lib/knowledge"); knowledge = await ingestPending({ digests: 60, pdfs: 30, notes: 15 }); } catch { /* never block the feed */ }
    // Keep the visitor log lean: 60 days is plenty for the admin report.
    try {
      const svc = createServiceClient();
      await svc.from("page_views").delete().lt("created_at", new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString());
    } catch { /* never block the feed */ }
  }
  return NextResponse.json({ ok: true, added: result.added, checked: result.checked, emailed: digest.sent, offline, durations, knowledge, cases, gapDigest });
}
