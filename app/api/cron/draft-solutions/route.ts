import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { isOffPeakNow } from "@/lib/offpeak";
import { draftSectionSolutionsBatch, queueMissingSectionSolutions, relayoutApprovedKeysBatch } from "@/lib/solutionDraft";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Answer-key writer. Drafting a full ICAI-style solution for a whole paper is
// several long AI calls, so it runs in the quiet overnight window and takes a
// few papers per pass — the queue drains hands-free without spiking the daily
// AI spend. ?force=1 runs it on demand from the admin page.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = params.get("force") === "1";
  if (!isOffPeakNow() && !force) return NextResponse.json({ ok: true, result: "skipped-peak" });

  const started = Date.now();
  const done: string[] = [];
  const failed: string[] = [];

  // Make sure the DESCRIPTIVE TESTS with no answer key are in the queue. They
  // live in `sections` and were missed entirely by the original drafter, so
  // 37 published tests had nothing to mark a student's answer book against.
  let queuedTests = 0;
  try {
    queuedTests = (await queueMissingSectionSolutions()).queued;
  } catch { /* queueing must never stop the drafting below */ }

  // DESCRIPTIVE TESTS ONLY, five at a time. The founder does not want keys
  // for the repository MTP/RTP papers — those are drafted by nobody now.
  const batch = await draftSectionSolutionsBatch(5, 200_000);
  done.push(...batch.drafted);
  failed.push(...batch.failed);

  // With nothing left to draft, spend the window re-laying out the APPROVED
  // keys in ICAI's presentation. The new text waits in pending_md beside the
  // approved one — nothing a student reads changes until the founder adopts it.
  let relaidOut = 0;
  let relayoutLeft = 0;
  if (!done.length && !failed.length && Date.now() - started < 200_000) {
    const r = await relayoutApprovedKeysBatch(4, 200_000 - (Date.now() - started));
    relaidOut = r.done.length;
    relayoutLeft = r.remaining;
    failed.push(...r.failed);
  }

  // With the paper queue clear, spend what's left of the window filling in
  // missing MCQ / case-study explanations — every one of those questions
  // already has its correct answer; only the "why" was never written.
  let mcqExplained = 0;
  let caseExplained = 0;
  if (!done.length && !failed.length && !relaidOut && !relayoutLeft) {
    // Nothing to draft or re-lay out — spend the window on the "why" lines.
    const { backfillMcqExplanations, backfillCaseExplanations } = await import("@/lib/explainBackfill");
    while (Date.now() - started < 240_000) {
      const n = await backfillMcqExplanations(20);
      mcqExplained += n;
      if (!n) break;
    }
    while (Date.now() - started < 260_000) {
      const n = await backfillCaseExplanations(20);
      caseExplained += n;
      if (!n) break;
    }
  }

  return NextResponse.json({
    ok: true,
    queuedTests,
    drafted: done.length,
    relaidOut,
    relayoutLeft,
    failedCount: failed.length,
    mcqExplained,
    caseExplained,
    done,
    failed,
  });
}
