"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Schedule a marketing message. The date/time is entered in IST; store as UTC.
export async function schedulePost(formData: FormData) {
  if (!(await requireAdmin())) return;
  const body = str(formData.get("body"));
  const when = str(formData.get("send_at")); // "2026-07-20T18:30" (IST, from datetime-local)
  if (!body || !when) return;
  // IST = UTC+5:30 — convert the wall-clock IST input to a UTC instant.
  const utc = new Date(new Date(`${when}:00Z`).getTime() - (5 * 60 + 30) * 60 * 1000);
  await createServiceClient().from("scheduled_posts").insert({
    body,
    link_url: str(formData.get("link_url")) || null,
    send_at: utc.toISOString(),
    to_tg_channel: formData.get("to_tg_channel") === "on",
    to_tg_groups: formData.get("to_tg_groups") === "on",
    to_discord: formData.get("to_discord") === "on",
    to_direct: formData.get("to_direct") === "on",
  });
  revalidatePath("/admin/broadcasts");
}

export async function deletePost(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("scheduled_posts").delete().eq("id", id);
  revalidatePath("/admin/broadcasts");
}

// "Send now" — flip the schedule to the past; the 10-minute cron picks it up
// on its next pass (within ~10 minutes).
export async function sendPostNow(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("scheduled_posts").update({ send_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id).eq("status", "pending");
  revalidatePath("/admin/broadcasts");
}
