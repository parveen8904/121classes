import { createServiceClient } from "@/lib/supabase/service";
import type { PlanSetup } from "@/lib/planner/load";

// Named, DATE-FREE study-plan templates.
//
// A template stores how the plan is shaped — speed, revision rounds, scope,
// how many days each stage gets, whether Sundays are worked — and deliberately
// stores NO dates. Dates belong to the student: when someone applies a
// template, their own start date and exam date are written in and the engine
// lays the same shape onto their calendar.

/** The date-bearing fields a template must never carry. */
type DateFree = Omit<PlanSetup, "subjectId" | "startDate" | "examDate"> & { doneClasses?: number };

export type NamedTemplate = {
  id: string;
  name: string;
  note: string | null;
  subject_id: string | null;
  span_days: number | null;
  setup: DateFree;
};

/** Strip everything that ties a plan to particular days. */
export function toDateFree(setup: PlanSetup): DateFree {
  const { subjectId: _s, startDate: _st, examDate: _e, holidays: _h, extraDays: _x, ...rest } = setup;
  // holidays/extraDays are specific calendar days too — a template keeps the
  // shape, not one student's leave.
  return { ...rest, doneClasses: 0 };
}

export async function listTemplates(subjectId?: string | null): Promise<NamedTemplate[]> {
  const svc = createServiceClient();
  let q = svc.from("planner_templates").select("id, name, note, subject_id, span_days, setup").eq("is_active", true);
  if (subjectId) q = q.or(`subject_id.eq.${subjectId},subject_id.is.null`);
  const { data } = await q.order("name");
  return (data ?? []) as unknown as NamedTemplate[];
}

export async function saveTemplate(input: {
  name: string;
  note?: string | null;
  subjectId: string | null;
  spanDays: number | null;
  setup: PlanSetup;
}): Promise<void> {
  await createServiceClient().from("planner_templates").insert({
    name: input.name.slice(0, 80),
    note: (input.note ?? "").slice(0, 300) || null,
    subject_id: input.subjectId,
    span_days: input.spanDays,
    setup: toDateFree(input.setup),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await createServiceClient().from("planner_templates").delete().eq("id", id);
}

/** Put a template onto ONE student's calendar: their subject, their start,
 * their exam date. The template supplies everything else. */
export function setupFromTemplate(
  t: NamedTemplate,
  student: { subjectId: string; startDate: string; examDate: string; doneClasses?: number },
): PlanSetup {
  return {
    ...(t.setup as Omit<PlanSetup, "subjectId" | "startDate" | "examDate">),
    subjectId: student.subjectId,
    startDate: student.startDate,
    examDate: student.examDate,
    doneClasses: student.doneClasses ?? 0,
  };
}

/** When a template has a span but the student gave no exam date, the plan
 * simply runs span_days from their start. */
export function examDateForSpan(startDate: string, spanDays: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + spanDays);
  return d.toISOString().slice(0, 10);
}
