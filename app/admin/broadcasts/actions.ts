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

// Full control over one still-pending post: its text, each platform's own
// version, the link, the campaign name, when it goes out and — the founder's
// ask — exactly which channels it goes to. Nothing here is decided for him.
const CHANNEL_FIELDS = [
  "to_tg_channel", "to_tg_groups", "to_discord", "to_direct", "to_whatsapp",
  "to_instagram", "to_youtube", "to_yt_video", "to_twitter", "to_linkedin",
  "to_facebook", "to_substack", "to_medium", "to_reddit", "to_quora", "to_google", "to_threads", "to_ig_personal",
] as const;

export async function updatePost(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const body = str(formData.get("body"));
  if (!id || !body) return;
  const when = str(formData.get("send_at")); // IST datetime-local
  const patch: Record<string, unknown> = {
    body,
    campaign: str(formData.get("campaign")) || null,
    link_url: str(formData.get("link_url")) || null,
    wa_template: str(formData.get("wa_template")) || null,
    ig_text: str(formData.get("ig_text")) || null,
    yt_text: str(formData.get("yt_text")) || null,
    x_text: str(formData.get("x_text")) || null,
    // The video is what turns this post into a Reel and a Short rather than a
    // still card nobody sees.
    video_url: str(formData.get("video_url")) || null,
  };
  // The edit form always submits every channel box, so an unticked one really
  // does turn the channel off.
  for (const f of CHANNEL_FIELDS) patch[f] = formData.get(f) === "on";
  if (when) patch.send_at = new Date(new Date(`${when}:00Z`).getTime() - (5 * 60 + 30) * 60 * 1000).toISOString();
  await createServiceClient().from("scheduled_posts").update(patch).eq("id", id).eq("status", "pending");
  revalidatePath("/admin/broadcasts");
}

// The standing brief the copywriter reads before every post: which attempt
// students are preparing for, where they actually are in it today, festivals
// worth a greeting, and what is going on in the profession. Without this the
// AI writes exam-eve copy in July.
export async function saveScenario(formData: FormData) {
  if (!(await requireAdmin())) return;
  const { BRIEF_KEYS } = await import("@/lib/marketingBrief");
  const rows = [
    { key: BRIEF_KEYS.attempt, value: str(formData.get("attempt")).trim() },
    { key: BRIEF_KEYS.stage, value: str(formData.get("stage")).trim() },
    { key: BRIEF_KEYS.festivals, value: str(formData.get("festivals")).trim() },
    { key: BRIEF_KEYS.news, value: str(formData.get("news")).trim() },
  ];
  await createServiceClient().from("site_settings").upsert(rows, { onConflict: "key" });
  revalidatePath("/admin/broadcasts");
}
