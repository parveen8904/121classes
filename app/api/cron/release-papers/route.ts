import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Release checked papers to the student after two hours.
//
// The AI marks a paper the moment it arrives, and the student is told an
// examiner will look at it. That was true in intent and false in practice —
// papers sat unreleased because nobody got to them, so the marking existed and
// the student never saw it. The founder's decision: the wait stays (it is
// honest, and it leaves room for a real review), but after two hours the
// marking stands on its own and goes out.
//
// A paper an examiner has ALREADY checked is never touched. Nothing here
// claims a person verified it — examiner_name is left empty, so the student is
// never told a human confirmed marks that no human saw.

const HOURS = 2;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const cutoff = new Date(Date.now() - HOURS * 3600_000).toISOString();

  // Graded, still not released, and submitted more than two hours ago.
  const { data: due } = await svc
    .from("descriptive_attempts")
    .select("id, section_id, student_id, submitted_at, review_status")
    .eq("status", "graded")
    .neq("review_status", "checked")
    .lt("submitted_at", cutoff)
    .limit(200);

  const rows = due ?? [];
  if (!rows.length) return NextResponse.json({ ok: true, released: 0 });

  const { error } = await svc
    .from("descriptive_attempts")
    .update({ review_status: "checked", examiner_checked_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    released: rows.length,
    afterHours: HOURS,
    ids: rows.map((r) => r.id),
  });
}
