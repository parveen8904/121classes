import { createServiceClient } from "@/lib/supabase/service";

// RECORDING WHAT HAPPENS TO A PAPER.
//
// Four things, and only four: a paper arrived, a paper failed to arrive, a
// student read their marks, a student opened their checked copy. Everything the
// report needs and nothing else — this is a count of events, not a log of
// people's movements.
//
// Every function here is best-effort and silent. Recording must never be the
// reason an upload fails or a page 500s; a missing row costs a number on a
// report, a thrown error costs a student their paper.

export type PaperEventKind =
  /** Bytes have begun moving. A start with no arrival is a student who gave up. */
  | "upload_started"
  | "upload_ok"
  | "upload_failed"
  | "result_viewed"
  | "copy_viewed";

export async function recordPaperEvent(e: {
  kind: PaperEventKind;
  studentId?: string | null;
  attemptId?: string | null;
  source?: "portal" | "paper_check" | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await createServiceClient().from("paper_events").insert({
      kind: e.kind,
      student_id: e.studentId ?? null,
      attempt_id: e.attemptId ?? null,
      source: e.source ?? null,
      // Trimmed: the useful part of a failure is its first line, and a stack
      // trace in a report column helps nobody.
      detail: e.detail ? String(e.detail).slice(0, 200) : null,
    });
  } catch {
    /* never let bookkeeping break the thing being booked */
  }
}

/**
 * ONE VIEW PER PERSON PER DAY, PER PAPER.
 *
 * A student reading their marks opens the page, scrolls, comes back after
 * lunch. Counting every load would report ten "views" for one student and make
 * the number meaningless — the question being asked is "did they look at it",
 * not "how many times did the page render".
 */
export async function recordPaperViewOnce(e: {
  kind: "result_viewed" | "copy_viewed";
  studentId: string;
  attemptId?: string | null;
  source?: "portal" | "paper_check" | null;
}): Promise<void> {
  try {
    const svc = createServiceClient();
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    let q = svc.from("paper_events").select("id", { count: "exact", head: true })
      .eq("kind", e.kind)
      .eq("student_id", e.studentId)
      .gte("created_at", since.toISOString());
    // A student may have several papers; each one is worth counting once.
    q = e.attemptId ? q.eq("attempt_id", e.attemptId) : q.is("attempt_id", null);

    const { count } = await q;
    if ((count ?? 0) > 0) return;

    await recordPaperEvent(e);
  } catch {
    /* as above */
  }
}
