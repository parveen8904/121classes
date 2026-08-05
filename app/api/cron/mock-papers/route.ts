import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { draftMockPaper } from "@/lib/mockPapers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Draft the waiting mock papers without anybody pressing anything.
//
// The founder asked me to draft them. I cannot press a button inside his admin
// session, and the overnight job would not reach them until the small hours. So
// this runs every ten minutes, takes ONE paper per pass, and is a no-op the
// moment nothing is queued — which is almost always.
//
// One paper per pass on purpose: it is two long calls, the questions and then
// the answers to those exact questions, and a pass that tries two can run out
// of time halfway and leave a paper half-written with nobody sure which.
//
// It only ever produces DRAFTS. Publishing stays his decision — a wrong figure
// in a mock paper costs a student three hours and teaches them the wrong thing.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // Reclaim anything stranded. A row is flipped to "drafting" before its long
  // call starts, so a pass that runs out of time leaves it claimed for ever —
  // which is exactly what happened to paper 1: stuck at "drafting", invisible
  // to every later pass, and nothing said so. Anything held for more than ten
  // minutes is certainly dead.
  await svc
    .from("mock_papers")
    .update({ status: "queued" })
    .eq("status", "drafting")
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

  // A paper whose questions are written but whose answers are not is the most
  // urgent thing here — it is half a paper until the second pass runs.
  const { data: next } = await svc
    .from("mock_papers")
    .select("id, paper_no, course, subject, status")
    .in("status", ["questions_ready", "queued", "failed"])
    .order("status", { ascending: true })
    .order("paper_no")
    .limit(1)
    .maybeSingle();

  if (!next) return NextResponse.json({ ok: true, result: "nothing waiting" });

  const started = Date.now();
  const r = await draftMockPaper(String(next.id));

  const { count: left } = await svc
    .from("mock_papers")
    .select("id", { count: "exact", head: true })
    .in("status", ["questions_ready", "queued", "failed", "drafting"]);

  console.log(
    `[mock_papers] paper ${next.paper_no} ${r.ok ? `${r.stage} written` : `FAILED: ${r.error}`}` +
      ` in ${Math.round((Date.now() - started) / 1000)}s — ${left ?? 0} still waiting`,
  );

  return NextResponse.json({
    ok: r.ok,
    paper: next.paper_no,
    error: r.error ?? null,
    tookSeconds: Math.round((Date.now() - started) / 1000),
    stillWaiting: left ?? 0,
  });
}
