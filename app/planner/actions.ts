"use server";

import { createClient } from "@/lib/supabase/server";
import type { PlanSetup, SchedEntry } from "@/lib/plan";

// Save the student's plan + generated day-by-day schedule server-side so
// reminders can read it and it syncs across devices.
export async function savePlan(setup: PlanSetup, schedule: SchedEntry[], remind: boolean): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  await supabase.from("study_plans").upsert(
    { user_id: user.id, setup, schedule, remind, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return { ok: true };
}

export async function setRemind(remind: boolean): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  await supabase.from("study_plans").update({ remind }).eq("user_id", user.id);
  return { ok: true };
}
