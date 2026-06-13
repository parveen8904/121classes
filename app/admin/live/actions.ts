"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../_lib/util";

// Merge the schedule fields into a live_class section's config (preserving
// any other keys like zoom_webinar_id).
export async function updateLiveSchedule(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("config").eq("id", id).maybeSingle();
  const config: Record<string, unknown> = { ...((sec?.config as Record<string, unknown>) ?? {}) };

  for (const key of ["join_url", "starts_at", "recording_url"] as const) {
    const v = nullable(formData.get(key));
    if (v !== null) config[key] = v;
    else delete config[key];
  }
  await supabase.from("sections").update({ config }).eq("id", id);
  revalidatePath("/admin/live");
}
