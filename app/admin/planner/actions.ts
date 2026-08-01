"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

async function isAdmin(): Promise<boolean> {
  return requireArea("planner"); // admin always; operator/faculty with this right
}

function num(formData: FormData, key: string): number | null {
  const v = Number(str(formData.get(key)));
  return Number.isFinite(v) && str(formData.get(key)) !== "" ? v : null;
}

// Per-subject exhaustive-window parameters (months before exam, max, target).
export async function saveSubjectPlan(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("subjects")
    .update({
      plan_start_months_before_exam: num(formData, "start_months"),
      plan_max_months: num(formData, "max_months"),
      plan_target_months: num(formData, "target_months"),
    })
    .eq("id", id);
  revalidatePath("/admin/planner");
}

// Global planner constants (exhaustive + the three revision rounds), stored as
// one JSON blob in site_settings.planner_config.
export async function savePlannerConfig(formData: FormData) {
  if (!(await isAdmin())) return;
  const cfg = {
    exhaustive_daily_hours: num(formData, "ex_hours"),
    exhaustive_homework_pct: num(formData, "ex_homework"),
    base_speed: num(formData, "base_speed"),
    max_speed: num(formData, "max_speed"),
    rr1: {
      start_months_before: num(formData, "rr1_start"),
      days: num(formData, "rr1_days"),
      daily_hours: num(formData, "rr1_hours"),
      video_pct: num(formData, "rr1_vpct"),
      video_speed: num(formData, "rr1_vspeed"),
    },
    rr2: {
      start_months_before: num(formData, "rr2_start"),
      days: num(formData, "rr2_days"),
      daily_hours: num(formData, "rr2_hours"),
      video_pct: num(formData, "rr2_vpct"),
      video_speed: num(formData, "rr2_vspeed"),
    },
    rr3: {
      days: num(formData, "rr3_days"),
      daily_hours: num(formData, "rr3_hours"),
      video_speed: num(formData, "rr3_vspeed"),
    },
  };
  await createServiceClient()
    .from("site_settings")
    .upsert({ key: "planner_config", value: JSON.stringify(cfg) }, { onConflict: "key" });
  revalidatePath("/admin/planner");
}

// ---- Named, date-free plan templates -------------------------------------
// The founder shapes a plan in the preview, then saves it under a name. The
// template keeps the shape (speed, revision rounds, scope, stage lengths) and
// deliberately keeps NO dates — a student applying it gets the same shape laid
// onto their own start and exam dates.

export async function savePlannerTemplate(formData: FormData) {
  if (!(await requireArea("planner"))) return;
  const name = str(formData.get("name")).trim();
  if (!name) return;
  const subjectId = str(formData.get("subject_id")) || null;
  const start = str(formData.get("start"));
  const exam = str(formData.get("exam"));

  // The span is what makes a template date-free but still meaningful: how
  // many days the plan runs, taken from the preview it was built from.
  const spanDays =
    start && exam
      ? Math.max(1, Math.round((Date.parse(`${exam}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000))
      : null;

  const { saveTemplate } = await import("@/lib/planner/namedTemplates");
  await saveTemplate({
    name,
    note: str(formData.get("note")),
    subjectId,
    spanDays,
    setup: {
      subjectId: subjectId ?? "",
      startDate: start,
      examDate: exam,
      speed: Number(str(formData.get("speed"))) || 1,
      doneClasses: 0,
      revisions: Number(str(formData.get("rev"))) || undefined,
    },
  });
  revalidatePath("/admin/planner");
  redirect("/admin/planner?tpl=saved");
}

export async function deletePlannerTemplate(formData: FormData) {
  if (!(await requireArea("planner"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const { deleteTemplate } = await import("@/lib/planner/namedTemplates");
  await deleteTemplate(id);
  revalidatePath("/admin/planner");
}
