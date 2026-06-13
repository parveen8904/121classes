"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { zoomConfigured, createZoomMeeting } from "@/lib/zoom";
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

// Auto-create a Zoom meeting from the section's title + start time and store
// the join link + meeting id. No-ops gracefully if Zoom isn't configured.
export async function createZoomForLive(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  if (!zoomConfigured()) redirect("/admin/live?zoom=unconfigured");

  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("title, config").eq("id", id).maybeSingle();
  const config: Record<string, unknown> = { ...((sec?.config as Record<string, unknown>) ?? {}) };
  const startLocal = typeof config.starts_at === "string" ? config.starts_at : "";

  const meeting = await createZoomMeeting(sec?.title ?? "Live class", startLocal, 60);
  if (!meeting) redirect("/admin/live?zoom=failed");

  config.join_url = meeting.join_url;
  if (meeting.id) config.zoom_webinar_id = meeting.id;
  await supabase.from("sections").update({ config }).eq("id", id);
  revalidatePath("/admin/live");
  redirect("/admin/live?zoom=created");
}
