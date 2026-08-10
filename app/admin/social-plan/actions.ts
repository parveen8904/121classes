"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Super-admin only, exactly as the campaigns page it feeds. There is no staff
// area for this: what goes out under his name in public is his to decide.
async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}
import { str } from "../_lib/util";
import { ensureWeekPlanned } from "@/lib/socialIdeas";
import { weekStart } from "@/lib/socialRhythm";

// Draw up a week. Safe to press twice — it never touches a slot he has already
// amended or dropped.
export async function planWeek(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const week = str(formData.get("week")) || new Date().toISOString().slice(0, 10);
  await ensureWeekPlanned(week);
  revalidatePath("/admin/social-plan");
}

// Amend one slot. This is the whole point of the page: the plan is a
// suggestion, and a suggestion nobody can change is an instruction.
export async function amendSlot(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const title = str(formData.get("idea_title"));
  const body = str(formData.get("idea_body"));
  if (!id) return;
  await createServiceClient().from("social_plan_slots").update({
    idea_title: title || null,
    idea_body: body || null,
    // Marked as his, not ours. Next week's regeneration leaves it alone, and
    // he can see at a glance which slots he has been through.
    status: "amended",
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/admin/social-plan");
}

/** Drop a slot for this week — or put it back. */
export async function toggleSkip(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const to = str(formData.get("to")) === "skip" ? "skipped" : "amended";
  if (!id) return;
  await createServiceClient().from("social_plan_slots")
    .update({ status: to, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/social-plan");
}

// HAND A SLOT TO THE POSTING QUEUE.
//
// Nothing on this page publishes anything. This writes a row into
// scheduled_posts — the same queue the campaigns page fills — with the channel
// switches this slot calls for and the time it should go. What actually leaves
// the building is still decided there, by the machinery that already has the
// tokens and the approval step.
//
// The Discord voice call is deliberately NOT schedulable: nothing is published
// by it, somebody turns up. Scheduling it would put an empty post in a queue.
export async function scheduleSlot(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: slot } = await svc.from("social_plan_slots").select("*").eq("id", id).maybeSingle();
  if (!slot) return;

  const s = slot as {
    kind: string; channels: string[]; slot_date: string; slot_time: string;
    idea_title: string | null; idea_body: string | null; source_url: string | null; scheduled_post_id: string | null;
  };
  if (s.kind === "meeting" || s.scheduled_post_id) return;

  const on = (c: string) => s.channels.includes(c);
  // IST → UTC. The slot times are what the founder reads on the page; the queue
  // works in UTC, and getting this wrong would post at three in the morning.
  const sendAt = new Date(`${s.slot_date}T${s.slot_time}:00+05:30`).toISOString();

  const { data: created } = await svc.from("scheduled_posts").insert({
    body: s.idea_body ?? "",
    link_url: s.source_url,
    send_at: sendAt,
    status: "draft",
    campaign: "Weekly rhythm",
    source_kind: "social_plan",
    source_label: s.idea_title,
    source_url: s.source_url,
    created_by: "Weekly plan",
    to_twitter: on("x"),
    to_linkedin: on("linkedin"),
    to_medium: on("medium"),
    to_substack: on("substack"),
    to_instagram: on("instagram"),
    to_facebook: on("facebook"),
    to_yt_video: on("youtube"),
  }).select("id").maybeSingle();

  await svc.from("social_plan_slots").update({
    status: "scheduled",
    scheduled_post_id: (created as { id: string } | null)?.id ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/admin/social-plan");
  revalidatePath("/admin/campaigns");
}

/** Everything still standing for the week, in one go. */
export async function scheduleWeek(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const week = weekStart(str(formData.get("week")) || new Date().toISOString().slice(0, 10));
  const svc = createServiceClient();
  const { data } = await svc.from("social_plan_slots")
    .select("id, kind, status").eq("week_start", week);
  for (const row of (data ?? []) as { id: string; kind: string; status: string }[]) {
    if (row.kind === "meeting" || row.status === "skipped" || row.status === "scheduled") continue;
    const fd = new FormData();
    fd.set("id", row.id);
    await scheduleSlot(fd);
  }
  revalidatePath("/admin/social-plan");
}
