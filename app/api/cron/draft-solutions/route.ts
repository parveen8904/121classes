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

  // ── DOES EACH KEY BELONG TO ITS OWN PAPER? ────────────────────────────
  //
  // This goes FIRST, and it goes here rather than staying a button, because a
  // key that answers another paper marks every student who sits that test at
  // close to zero — and it did, for a fortnight, unnoticed. Comparing two sets
  // of first pages is cheap; drafting a whole key is not. So the checks take
  // their small bite of the window before anything expensive starts.
  //
  // Two sweeps, because there are two kinds of key. Uploaded solution PDFs can
  // be for the wrong paper entirely. Keys we wrote ourselves are drafted FROM
  // the question paper, so they cannot be for another paper — but they can stop
  // after Q2 of a three-question paper, which costs a student the same marks.
  let keysChecked = 0, keysBad = 0, keysShort = 0;
  try {
    const { auditKeyMatchesPaper, auditDraftedKeys } = await import("@/lib/solutionAudit");
    const a = await auditKeyMatchesPaper(4, 60_000);
    const b = await auditDraftedKeys(4, 60_000);
    keysChecked = a.checked + b.checked;
    keysBad = a.mismatched.length + b.mismatched.length;
    keysShort = a.incomplete.length + b.incomplete.length;
  } catch (e) {
    failed.push(`key match: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Then put right whatever has been found. A wrong key is worse than a missing
  // one — a missing key marks nobody, a wrong key marks everybody wrongly — so
  // repairs come before drafting the keys that were never written.
  let keysRepaired = 0;
  try {
    if (Date.now() - started < 120_000) {
      const { repairBadKeys } = await import("@/lib/solutionAudit");
      const r = await repairBadKeys(2, 100_000);
      keysRepaired = r.repaired.length;
      failed.push(...r.failed.map((f) => `${f.title}: ${f.why}`));
    }
  } catch (e) {
    failed.push(`key repair: ${e instanceof Error ? e.message : "failed"}`);
  }

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

  // Mock exam papers waiting to be drafted. They are the slowest thing here —
  // two long calls each — so they go first in the quiet window, and only ever
  // reach "drafted": publishing one is the founder's decision, not a cron's.
  let mockDrafted = 0;
  try {
    const { draftMockPaper } = await import("@/lib/mockPapers");
    const { createServiceClient } = await import("@/lib/supabase/service");
    const svc = createServiceClient();
    const { data: waiting } = await svc
      .from("mock_papers")
      .select("id")
      .in("status", ["questions_ready", "queued", "failed"])
      .order("paper_no")
      .limit(3);
    for (const row of waiting ?? []) {
      if (Date.now() - started > 150_000) break;
      const r = await draftMockPaper(String(row.id));
      if (r.ok) mockDrafted += 1;
    }
  } catch (e) {
    failed.push(`mock papers: ${e instanceof Error ? e.message : "failed"}`);
  }

  // With nothing left to draft, spend the window re-laying out the APPROVED
  // keys in ICAI's presentation. The new text waits in pending_md beside the
  // approved one — nothing a student reads changes until the founder adopts it.
  let relaidOut = 0;
  let relayoutLeft = 0;
  if (!done.length && !failed.length && !keysRepaired && Date.now() - started < 200_000) {
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
  if (!done.length && !failed.length && !keysRepaired && !relaidOut && !relayoutLeft) {
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
    keysChecked,
    keysBad,
    keysShort,
    keysRepaired,
    queuedTests,
    mockDrafted,
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
