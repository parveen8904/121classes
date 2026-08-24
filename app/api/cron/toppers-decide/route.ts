import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { istDay, recordToppers, findToppers } from "@/lib/dailyToppers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 11:59 PM IST — WHO TOPPED TODAY.
//
// Deciding and announcing are two jobs three hours apart, on purpose. This one
// freezes the answer at the end of the day; the 3 AM job only reads it. Working
// it out again at send time would let a copy released at half past midnight
// change who was named for a day that had already closed.
//
// The day is measured on when a copy was RELEASED to the student, which is his
// rule: a paper written at 2 AM and released at 4 AM belongs to the day it was
// released. Firing at 23:59 IST means this job's own "today" is that same day.
//
// ?day=YYYY-MM-DD re-decides one day by hand. ?dry=1 shows the answer without
// writing it.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const asked = params.get("day");
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : istDay();

  try {
    if (params.get("dry") === "1") {
      return NextResponse.json({ ok: true, day, toppers: await findToppers(day) });
    }
    const rows = await recordToppers(day);
    return NextResponse.json({
      ok: true, day, decided: rows.length,
      // Names only — this response is read in logs, and the rule about what
      // may be shown applies there too.
      toppers: rows.map((r) => ({ track: r.track, name: r.student_name })),
    });
  } catch (e) {
    // Loud. A silent failure here means 3 AM announces nothing and nobody knows
    // why the toppers stopped.
    return NextResponse.json({ ok: false, day, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
