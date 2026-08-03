import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { gradeSubmittedPaper } from "@/app/learn/section/[sectionId]/paperActions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Mark the papers that have come in.
//
// Marking used to run inside the student's own submit request: the
// already-marked scan, building the marking scheme, the grading call and
// drawing the annotated copy, all while they watched a 2 MB upload appear to
// hang. It was slow for everyone and it timed out — one paper reached the
// examiner desk with no marks on it at all.
//
// Submitting now records the file and returns. This runs every few minutes and
// does the work, which is exactly what the student is told happens.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const started = Date.now();

  // Oldest first, so nobody is overtaken by a later submission.
  const { data: waiting } = await svc
    .from("descriptive_attempts")
    .select("id, section_id")
    .eq("status", "submitted")
    .is("report", null)
    .order("submitted_at", { ascending: true })
    .limit(20);

  const done: string[] = [];
  const failed: string[] = [];

  for (const row of waiting ?? []) {
    // One paper is two long AI calls on its first run for a test (the marking
    // scheme, then the grading). Never start one that cannot finish.
    if (Date.now() - started > 180_000) break;
    try {
      const r = await gradeSubmittedPaper(String(row.id));
      if (r.graded) done.push(String(row.id));
      else failed.push(`${row.id}: ${r.reason ?? "not graded"}`);
    } catch (e) {
      failed.push(`${row.id}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    graded: done.length,
    failed: failed.length,
    waiting: (waiting ?? []).length,
    details: failed.slice(0, 5),
  });
}
