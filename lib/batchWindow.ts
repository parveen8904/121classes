import type { SupabaseClient } from "@supabase/supabase-js";

// WHEN A LIVE BATCH ACTUALLY FINISHES.
//
// The date could be typed onto the subject, and it can still be overridden
// there. But it is already known: the class schedule holds every session with
// its date, so asking the schedule means one source of truth instead of two
// that drift apart the first time a class moves.
//
// A batch whose last class slips by a week should extend everybody's access by
// a week without anyone remembering to edit a second field. Typing it twice is
// how a student ends up locked out of a class that was rescheduled.

export type BatchWindow = { lastClassOn: string | null; graceDays: number | null };

export async function batchWindow(
  svc: SupabaseClient,
  subjectId: string | null,
): Promise<BatchWindow | null> {
  if (!subjectId) return null;

  const { data: subj } = await svc
    .from("subjects")
    .select("batch_last_class_on, batch_grace_days, batch_months")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subj) return null;

  const row = subj as { batch_last_class_on?: string | null; batch_grace_days?: number | null; batch_months?: number | null };
  const grace = row.batch_grace_days ?? 10;

  // An explicit date on the subject wins — it is the one a human set on
  // purpose, perhaps for a batch whose schedule is not in the system yet.
  if (row.batch_last_class_on) return { lastClassOn: row.batch_last_class_on, graceDays: grace };

  // Otherwise ask the schedule. Cancelled sessions do not count: a batch does
  // not run longer because its final class was called off.
  const { data: last } = await svc
    .from("class_schedule")
    .select("scheduled_at")
    .eq("subject_id", subjectId)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const at = (last as { scheduled_at?: string } | null)?.scheduled_at ?? null;
  return at ? { lastClassOn: at, graceDays: grace } : null;
}
