"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadPlanInput } from "@/lib/planner/load";
import { generatePlan, type Plan } from "@/lib/planner/engine";
import type { SchedEntry } from "@/lib/plan";

// Adapt the engine's day-by-day output into the SchedEntry[] shape the dashboard
// TodayPlan widget + the weekly study reminders already read, so they keep
// working unchanged.
function toSchedule(plan: Plan): SchedEntry[] {
  return plan.days
    .filter((d) => d.stage !== "break")
    .map((d) => ({
      iso: d.date,
      date: new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
      label: d.meta ? `${d.task} — ${d.meta}` : d.task,
      mock: /mock/i.test(d.task),
    }));
}

// Save (create or regenerate) the student's plan. We persist the inputs in
// `setup` and a generated `schedule` snapshot (for TodayPlan + reminders); the
// rich /planner view always regenerates fresh from `setup` + live progress.
export async function savePlanSetup(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const setup = {
    subjectId: String(formData.get("subject") || ""),
    startDate: String(formData.get("start") || ""),
    examDate: String(formData.get("exam") || ""),
    speed: Number(formData.get("speed")) || 1.2,
    doneClasses: Math.max(0, Number(formData.get("done")) || 0),
  };
  if (!setup.subjectId || !setup.startDate || !setup.examDate) return;

  let schedule: SchedEntry[] = [];
  const input = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate, doneClasses: setup.doneClasses });
  if (input) {
    input.chosenSpeed = setup.speed;
    schedule = toSchedule(generatePlan(input));
  }

  await supabase.from("study_plans").upsert(
    { user_id: user.id, setup, schedule, remind: true, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  revalidatePath("/planner");
  redirect("/planner");
}

export async function clearPlan() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("study_plans").update({ setup: null, schedule: [] }).eq("user_id", user.id);
  revalidatePath("/planner");
  redirect("/planner");
}
