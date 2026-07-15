"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { zoomConfigured, createZoomMeeting } from "@/lib/zoom";
import { createServiceClient } from "@/lib/supabase/service";
import { str, num, nullable } from "../_lib/util";

// Standalone scheduled live class (not tied to any course/topic).
export async function createLiveSession(formData: FormData) {
  if (!(await requireArea("live"))) return;
  const title = str(formData.get("title"));
  if (!title) return;
  const svc = createServiceClient();
  await svc.from("live_sessions").insert({
    title,
    description: nullable(formData.get("description")),
    audience: nullable(formData.get("audience")),
    faculty_id: str(formData.get("faculty_id")) || null,
    starts_at: str(formData.get("starts_at")) ? new Date(str(formData.get("starts_at"))).toISOString() : null,
    duration_mins: num(formData.get("duration_mins"), 60),
    join_url: nullable(formData.get("join_url")),
    // White-label Zoom: paste the numeric meeting/webinar number + passcode and
    // students watch inside our site (no zoom.us link shown).
    zoom_meeting_number: str(formData.get("zoom_meeting_number")).replace(/\D/g, "") || null,
    zoom_passcode: nullable(formData.get("zoom_passcode")),
    is_published: formData.get("is_published") === "on",
  });
  revalidatePath("/admin/live");
  revalidatePath("/live");
  revalidatePath("/");
}

export async function updateLiveSession(formData: FormData) {
  if (!(await requireArea("live"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  await svc
    .from("live_sessions")
    .update({
      join_url: nullable(formData.get("join_url")),
      recording_url: nullable(formData.get("recording_url")),
      is_published: formData.get("is_published") === "on",
    })
    .eq("id", id);
  revalidatePath("/admin/live");
  revalidatePath("/live");
  revalidatePath("/");
}

export async function deleteLiveSession(formData: FormData) {
  if (!(await requireArea("live"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  await svc.from("live_sessions").delete().eq("id", id);
  revalidatePath("/admin/live");
  revalidatePath("/live");
}

// Merge the schedule fields into a live_class section's config (preserving
// any other keys like zoom_webinar_id).
export async function updateLiveSchedule(formData: FormData) {
  if (!(await requireArea("live"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = createServiceClient();
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
  if (!(await requireArea("live"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  if (!zoomConfigured()) redirect("/admin/live?zoom=unconfigured");

  const supabase = createServiceClient();
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
