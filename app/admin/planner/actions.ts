"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
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
