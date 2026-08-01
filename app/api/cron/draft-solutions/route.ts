import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { isOffPeakNow } from "@/lib/offpeak";
import { draftNextSolution } from "@/lib/solutionDraft";

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

  // Stop well before the platform's limit so a long paper never truncates.
  while (Date.now() - started < 240_000) {
    const r = await draftNextSolution();
    if (!r.done) break; // queue empty
    if (r.error) failed.push(`${r.title ?? "?"}: ${r.error}`);
    else done.push(r.title ?? "?");
  }

  // With the paper queue clear, spend what's left of the window filling in
  // missing MCQ / case-study explanations — every one of those questions
  // already has its correct answer; only the "why" was never written.
  let mcqExplained = 0;
  let caseExplained = 0;
  if (!done.length && !failed.length) {
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
    drafted: done.length,
    failedCount: failed.length,
    mcqExplained,
    caseExplained,
    done,
    failed,
  });
}
