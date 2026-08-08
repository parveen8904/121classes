import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { pushToDevices, type PushMessage } from "@/lib/push";

// TURNING QUEUED EVENTS INTO NOTIFICATIONS PEOPLE ACTUALLY WANT.
//
// The triggers record what happened. This decides who hears it, and how often.
//
// The hard part is not sending — it is NOT sending. A student who gets eight
// buzzes because eight classes were uploaded together turns notifications off,
// and then never hears the one that mattered. So events are gathered up and
// spoken once: "3 new items in Financial Reporting" beats three separate lines
// about material they have not looked at yet.

type Row = {
  id: string;
  kind: string;
  student_id: string | null;
  subject_id: string | null;
  title: string;
  body: string;
  link: string | null;
};

/** Categories the founder can switch off, in site_settings as push_off:<kind>. */
async function silenced(kind: string): Promise<boolean> {
  return (await getSecret(`push_off_${kind}`)) === "1";
}

/**
 * Everyone who should hear about a subject.
 *
 * Access, not interest: a live, unexpired, unblocked subscription that covers
 * this subject — either bought for the subject itself, or for the whole course
 * that contains it. A student whose plan lapsed last week is not told about a
 * class they cannot open; being notified about something you are then refused
 * is worse than silence.
 */
async function studentsForSubject(subjectId: string): Promise<string[]> {
  const svc = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: subj } = await svc.from("subjects").select("course_id").eq("id", subjectId).maybeSingle();
  const courseId = (subj as { course_id?: string } | null)?.course_id ?? null;

  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = svc
      .from("subscriptions")
      .select("student_id, subject_id, course_id")
      .eq("status", "active")
      .is("blocked_at", null)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) break;
    const page = data ?? [];
    for (const r of page as { student_id: string; subject_id: string | null; course_id: string | null }[]) {
      const coversSubject = r.subject_id === subjectId;
      // A course-wide subscription (no subject named) covers every subject in it.
      const coversCourse = !r.subject_id && courseId && r.course_id === courseId;
      if (coversSubject || coversCourse) ids.add(r.student_id);
    }
    if (page.length < PAGE) break;
  }
  return [...ids];
}

/** The live tokens for a set of students — read in pages, as always. */
async function tokensFor(studentIds: string[] | null): Promise<{ token: string; platform: string }[]> {
  const svc = createServiceClient();
  const out: { token: string; platform: string }[] = [];
  const PAGE = 1000;

  const read = async (ids: string[] | null) => {
    for (let from = 0; ; from += PAGE) {
      let q = svc
        .from("push_devices")
        .select("token, platform")
        .is("disabled_at", null)
        .range(from, from + PAGE - 1);
      if (ids) q = q.in("user_id", ids);
      const { data, error } = await q;
      if (error) break;
      const page = (data ?? []) as { token: string; platform: string }[];
      out.push(...page);
      if (page.length < PAGE) break;
    }
  };

  if (!studentIds) { await read(null); return out; }
  if (studentIds.length === 0) return out;
  // A very long IN list is rejected outright, so the students are asked for in
  // batches rather than all at once.
  for (let i = 0; i < studentIds.length; i += 200) await read(studentIds.slice(i, i + 200));
  return out;
}

/** One line that says what several events add up to. */
function coalesce(rows: Row[], subjectName: string | null): PushMessage {
  if (rows.length === 1) {
    return { title: rows[0].title, body: rows[0].body, link: rows[0].link ?? undefined };
  }
  const where = subjectName ? ` in ${subjectName}` : "";
  return {
    title: `${rows.length} new items${where}`,
    // Name the first couple so it is worth opening, rather than a bare count.
    body: rows.slice(0, 2).map((r) => r.body).filter(Boolean).join(" · ") + (rows.length > 2 ? " …" : ""),
    // A digest points at the shelf, not at any single one of them.
    link: subjectName ? "/dashboard" : rows[0].link ?? "/dashboard",
  };
}

export type DrainResult = { groups: number; sent: number; failed: number; skipped: number };

/**
 * Send everything waiting. Safe to run on a schedule and safe to run twice —
 * a row is marked sent before its group is left behind, so a crash mid-run
 * costs at most one repeat rather than a loop of them.
 */
export async function drainPushOutbox(limit = 500): Promise<DrainResult> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("push_outbox")
    .select("id, kind, student_id, subject_id, title, body, link")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  const rows = (data ?? []) as Row[];
  if (!rows.length) return { groups: 0, sent: 0, failed: 0, skipped: 0 };

  // Group by who hears it and what kind it is. Two different kinds are never
  // merged — "your copy is checked" must not be swallowed into a count of
  // classes.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.kind}|${r.student_id ?? ""}|${r.subject_id ?? ""}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const names = new Map<string, string>();
  const subjectIds = [...new Set(rows.map((r) => r.subject_id).filter(Boolean))] as string[];
  if (subjectIds.length) {
    const { data: subs } = await svc.from("subjects").select("id, title").in("id", subjectIds);
    for (const s of (subs ?? []) as { id: string; title: string }[]) names.set(s.id, s.title);
  }

  let sent = 0, failed = 0, skipped = 0;

  for (const [key, list] of groups) {
    const [kind] = key.split("|");
    const first = list[0];
    const done = new Date().toISOString();

    if (await silenced(kind)) {
      // Switched off on purpose: clear it rather than letting it pile up and
      // arrive in a flood the day it is switched back on.
      await svc.from("push_outbox").update({ sent_at: done, sent_count: 0 }).in("id", list.map((r) => r.id));
      skipped += list.length;
      continue;
    }

    const audience = first.student_id
      ? [first.student_id]
      : first.subject_id
        ? await studentsForSubject(first.subject_id)
        : null; // null = everyone

    const devices = await tokensFor(audience);
    const msg = coalesce(list, first.subject_id ? names.get(first.subject_id) ?? null : null);

    // One call: it splits iPhone from Android itself and retires dead tokens.
    const result = devices.length
      ? await pushToDevices(devices, msg)
      : { sent: 0, failed: 0, retired: 0 };

    await svc.from("push_outbox").update({ sent_at: done, sent_count: result.sent }).in("id", list.map((r) => r.id));
    sent += result.sent;
    failed += result.failed;
  }

  return { groups: groups.size, sent, failed, skipped };
}

/**
 * Live classes about to start.
 *
 * Queued rather than sent, so it travels the same road as everything else and
 * obeys the same off switch. The dedupe key is the session, so a class is
 * announced once however many times this runs.
 */
export async function queueStartingSoon(): Promise<number> {
  const svc = createServiceClient();
  const now = Date.now();
  const { data } = await svc
    .from("live_sessions")
    .select("id, title, starts_at")
    .eq("is_published", true)
    .gte("starts_at", new Date(now).toISOString())
    .lte("starts_at", new Date(now + 45 * 60_000).toISOString());

  let queued = 0;
  for (const s of (data ?? []) as { id: string; title: string; starts_at: string }[]) {
    const mins = Math.max(1, Math.round((new Date(s.starts_at).getTime() - now) / 60_000));
    const { error } = await svc.rpc("queue_push", {
      p_kind: "live_soon",
      p_student: null,
      p_subject: null,
      p_title: "Live class starting soon",
      p_body: `${s.title} starts in about ${mins} minutes.`,
      p_link: "/live",
      p_dedupe: `live_soon:${s.id}`,
    });
    if (!error) queued++;
  }
  return queued;
}
