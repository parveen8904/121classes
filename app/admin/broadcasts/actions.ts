"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
    campaign: str(formData.get("campaign")) || null,
    link_url: str(formData.get("link_url")) || null,
    send_at: utc.toISOString(),
    to_tg_channel: formData.get("to_tg_channel") === "on",
    to_tg_groups: formData.get("to_tg_groups") === "on",
    to_discord: formData.get("to_discord") === "on",
    to_direct: formData.get("to_direct") === "on",
    // WhatsApp bulk (Interakt) — needs a pre-approved template with one {{1}} variable.
    to_whatsapp: formData.get("to_whatsapp") === "on",
    wa_template: str(formData.get("wa_template")) || null,
    // Instagram/YouTube can't be reliably auto-posted — prepare-and-remind:
    // at send time the drafted post is emailed to the admins to publish manually.
    to_instagram: formData.get("to_instagram") === "on",
    to_youtube: formData.get("to_youtube") === "on",
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

// ---- Campaign packs & autopilot ---------------------------------------------

// Wall-clock IST date ("2026-07-20") + time ("19:00") → UTC instant.
function istToUtc(date: string, time: string): Date {
  return new Date(new Date(`${date}T${time}:00Z`).getTime() - (5 * 60 + 30) * 60 * 1000);
}

// Context the copywriter AI may mention — real happenings only.
async function marketingContext(svc: ReturnType<typeof createServiceClient>): Promise<string> {
  const { data: live } = await svc
    .from("live_sessions")
    .select("title, starts_at")
    .eq("is_published", true)
    .gte("starts_at", new Date().toISOString())
    .lte("starts_at", new Date(Date.now() + 14 * 86400e3).toISOString())
    .order("starts_at")
    .limit(5);
  const lines = (live ?? []).map((s) =>
    `- Live class "${s.title}" on ${new Date(s.starts_at as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST`);
  return lines.length ? lines.join("\n") : "- (no special events — promote the evergreen free tools)";
}

// One click → an AI-written multi-day pack, scheduled as pending posts the
// admin can still edit or delete before they go out.
export async function generatePack(formData: FormData) {
  if (!(await requireAdmin())) return;
  const theme = str(formData.get("custom_theme")) || str(formData.get("theme")) || "Free study tools for CA students";
  const days = Math.min(14, Math.max(1, parseInt(str(formData.get("days")), 10) || 7));
  const startDate = str(formData.get("start_date")) || new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const time = str(formData.get("post_time")) || "19:00";

  const svc = createServiceClient();
  const { generateCampaignPack } = await import("@/lib/ai");
  const posts = await generateCampaignPack(theme, days, await marketingContext(svc));
  if (!posts?.length) redirect("/admin/broadcasts?pack=fail");

  const toIg = formData.get("to_instagram") === "on";
  const toYt = formData.get("to_youtube") === "on";
  const rows = posts!.map((p) => ({
    body: p.message,
    campaign: theme,
    send_at: new Date(istToUtc(startDate, time).getTime() + p.day * 86400e3).toISOString(),
    to_tg_channel: formData.get("to_tg_channel") === "on",
    to_tg_groups: formData.get("to_tg_groups") === "on",
    to_discord: formData.get("to_discord") === "on",
    to_direct: false,
    to_whatsapp: formData.get("to_whatsapp") === "on",
    wa_template: str(formData.get("wa_template")) || null,
    to_instagram: toIg,
    to_youtube: toYt,
    ig_text: toIg ? p.instagram || null : null,
    yt_text: toYt ? p.youtube || null : null,
    created_by: "pack",
  }));
  await svc.from("scheduled_posts").insert(rows);
  revalidatePath("/admin/broadcasts");
  redirect(`/admin/broadcasts?pack=${rows.length}`);
}

// Edit a still-pending post (message, platform variants, time).
export async function updatePost(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const body = str(formData.get("body"));
  if (!id || !body) return;
  const when = str(formData.get("send_at")); // IST datetime-local
  const patch: Record<string, unknown> = {
    body,
    ig_text: str(formData.get("ig_text")) || null,
    yt_text: str(formData.get("yt_text")) || null,
  };
  if (when) patch.send_at = new Date(new Date(`${when}:00Z`).getTime() - (5 * 60 + 30) * 60 * 1000).toISOString();
  await createServiceClient().from("scheduled_posts").update(patch).eq("id", id).eq("status", "pending");
  revalidatePath("/admin/broadcasts");
}

// Weekly autopilot on/off (site_settings; read by /api/cron/marketing-autopilot).
export async function toggleAutopilot(formData: FormData) {
  if (!(await requireAdmin())) return;
  const next = formData.get("next") === "on" ? "on" : "off";
  await createServiceClient().from("site_settings").upsert(
    { key: "marketing_autopilot", value: next },
    { onConflict: "key" },
  );
  revalidatePath("/admin/broadcasts");
}
