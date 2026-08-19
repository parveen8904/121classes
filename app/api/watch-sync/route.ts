import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// OFFLINE WATCHING, ARRIVING LATE.
//
// A downloaded class plays with no connection, so nothing could be recorded and
// a student studying entirely on downloads looked idle everywhere: zero classes
// done on the dashboard, invisible on the leaderboard, and — worst — flagged by
// the mentoring desk as "was studying, now gone quiet" while they studied every
// day. It also meant the 2× fair-use watch cap never counted a second of
// offline viewing, so downloads were an unlimited side door around it.
//
// The offline player queues what was watched on the phone; this endpoint takes
// the queue whenever the app is next online and writes it exactly the way live
// watching is written — same table, same completed-at-90% rule, same caps — so
// every report and the fair-use meter see one truth.
//
// The reply carries the per-subject fair-use allowance, which the player caches
// and enforces while offline. Enforcement OFFLINE is necessarily approximate —
// the phone cannot ask the server mid-flight — but every sync trues it up.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: {
    records?: { sectionId?: string; videoSeconds?: number; realSeconds?: number; durationSeconds?: number }[];
    wantSections?: string[];
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }

  const records = (body.records ?? []).slice(0, 100);
  const want = new Set<string>((body.wantSections ?? []).slice(0, 200).map(String));

  for (const r of records) {
    const sectionId = String(r.sectionId ?? "").trim();
    if (!sectionId) continue;
    want.add(sectionId);
    const vs = Math.max(0, Math.round(Number(r.videoSeconds) || 0));
    // A queue can hold hours legitimately (a long bus ride of classes), but one
    // record is one class: cap at six hours so a corrupted counter cannot bank
    // a month of watch time.
    const delta = Math.min(6 * 3600, Math.max(0, Math.round(Number(r.realSeconds) || 0)));
    const dur = Math.max(0, Math.round(Number(r.durationSeconds) || 0));
    if (vs === 0 && delta === 0) continue;

    const { data: existing } = await supabase
      .from("class_watch")
      .select("video_seconds, real_seconds, duration_seconds, completed")
      .eq("student_id", user.id).eq("section_id", sectionId).maybeSingle();

    const newVideo = Math.max(Number(existing?.video_seconds ?? 0), vs);
    const newReal = Number(existing?.real_seconds ?? 0) + delta;
    const duration = dur || Number(existing?.duration_seconds ?? 0);
    const wasCompleted = existing?.completed ?? false;
    const completed = wasCompleted || (duration > 0 && newVideo >= duration * 0.9);

    await supabase.from("class_watch").upsert({
      student_id: user.id,
      section_id: sectionId,
      video_seconds: newVideo,
      real_seconds: newReal,
      duration_seconds: duration,
      completed,
      last_watched_at: new Date().toISOString(),
    }, { onConflict: "student_id,section_id" });

    if (completed && !wasCompleted) {
      await supabase.from("student_activity").insert({
        student_id: user.id, kind: "class_complete", section_id: sectionId,
        detail: { video_seconds: newVideo, real_seconds: newReal, offline: true },
      });
    }
  }

  // Which subject each section belongs to, and how much watch time that subject
  // still has. The player caches this and counts down against it offline.
  const sections: Record<string, string> = {};
  const allowances: Record<string, { remainingSeconds: number; unlimited: boolean }> = {};
  if (want.size) {
    const { data: secRows } = await supabase
      .from("sections").select("id, topics(subject_id)").in("id", [...want]);
    const subjIds = new Set<string>();
    for (const s of secRows ?? []) {
      const subj = (s as { topics?: { subject_id?: string } | null }).topics?.subject_id;
      if (subj) { sections[s.id as string] = subj; subjIds.add(subj); }
    }
    const { studentPlan, getAllLimits, limitFor, WATCH_CATEGORY } = await import("@/lib/entitlements");
    const [plan, limits] = await Promise.all([studentPlan(user.id), getAllLimits()]);
    const mult = limitFor(limits, plan, WATCH_CATEGORY);
    for (const subj of subjIds) {
      if (mult === -1 || mult <= 0) { allowances[subj] = { remainingSeconds: 0, unlimited: true }; continue; }
      const { data: fu } = await supabase.rpc("fair_use_status", { p_subject: subj, p_multiplier: mult });
      const row = (Array.isArray(fu) ? fu[0] : fu) as { budget_seconds?: number; used_seconds?: number } | null;
      const budget = Number(row?.budget_seconds) || 0;
      const used = Number(row?.used_seconds) || 0;
      allowances[subj] = budget > 0
        ? { remainingSeconds: Math.max(0, budget - used), unlimited: false }
        : { remainingSeconds: 0, unlimited: true };
    }
  }

  return NextResponse.json({ ok: true, synced: records.length, sections, allowances });
}
