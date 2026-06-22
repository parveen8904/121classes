"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clearSecretCache } from "@/lib/secrets";
import { ingestGovtFeeds } from "@/lib/govtfeed";
import { str, nullable } from "../_lib/util";

async function isAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Save the list of government/ICAI feed URLs to watch (newline-separated).
export async function saveGovtFeeds(formData: FormData) {
  if (!(await isAdmin())) return;
  const value = str(formData.get("govt_feeds")).trim();
  await createServiceClient().from("app_secrets").upsert(
    { key: "GOVT_FEEDS", value, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  clearSecretCache();
  redirect("/admin/announcements?feeds=saved");
}

// Pull new items now (also runs automatically every hour).
export async function fetchGovtFeedsNow() {
  if (!(await isAdmin())) return;
  const { added } = await ingestGovtFeeds();
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
  redirect(`/admin/announcements?fetched=${added}`);
}

// Save the keyword list that builds the auto Google-News feeds (newline/comma
// separated). Also lets the founder set where the hourly digest is emailed.
export async function saveFeedKeywords(formData: FormData) {
  if (!(await isAdmin())) return;
  const svc = createServiceClient();
  const now = new Date().toISOString();
  const rows = [
    { key: "FEED_KEYWORDS", value: str(formData.get("feed_keywords")).trim(), updated_at: now },
    { key: "FEED_NOISE", value: str(formData.get("feed_noise")).trim(), updated_at: now },
    { key: "FEED_DIGEST_EMAIL", value: str(formData.get("feed_digest_email")).trim(), updated_at: now },
  ];
  await svc.from("app_secrets").upsert(rows, { onConflict: "key" });
  clearSecretCache();
  redirect("/admin/announcements?feeds=saved");
}

// Broadcast a published announcement to students: queues a push for the (future)
// mobile app AND posts it to the Telegram channel now, so it reaches students
// today. Marks the announcement as broadcast so the button shows it was sent.
export async function broadcastAnnouncement(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: a } = await svc
    .from("announcements")
    .select("id, title, body, link_url, is_published")
    .eq("id", id)
    .maybeSingle();
  if (!a || !a.is_published) {
    redirect("/admin/announcements?bcast=unpublished");
  }

  // Post to the Telegram channel right now (reaches every member in one call).
  const { sendTelegramChannel } = await import("@/lib/notify");
  const tgText = a.body ? `${a.title}\n\n${a.body}` : a.title;
  const tgOk = await sendTelegramChannel(tgText, a.link_url ?? undefined);

  const nowISO = new Date().toISOString();
  await svc.from("broadcasts").insert([
    { announcement_id: a.id, title: a.title, body: a.body, link_url: a.link_url, channel: "telegram", status: tgOk ? "sent" : "failed", sent_at: tgOk ? nowISO : null },
    // Queued for the mobile app's push service to pick up once it exists.
    { announcement_id: a.id, title: a.title, body: a.body, link_url: a.link_url, channel: "push", status: "queued" },
  ]);
  await svc.from("announcements").update({ broadcast_at: nowISO }).eq("id", a.id);

  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
  redirect(`/admin/announcements?bcast=${tgOk ? "sent" : "queued"}`);
}

// Force-send the feed digest right now (the "email me the pending items" button),
// ignoring the once-a-day guard — so the founder can confirm email is working.
export async function sendDigestNow() {
  if (!(await isAdmin())) return;
  const { maybeSendDailyFeedDigest } = await import("@/lib/govtfeed");
  const { sent } = await maybeSendDailyFeedDigest({ force: true });
  redirect(`/admin/announcements?digest=${sent}`);
}

const KINDS = ["amendment", "whats_new", "student_corner", "industry", "macro"];

function readKind(formData: FormData): string {
  const v = str(formData.get("kind"));
  return KINDS.includes(v) ? v : "whats_new";
}

export async function createAnnouncement(formData: FormData) {
  const title = str(formData.get("title"));
  if (!title) return;
  const supabase = createClient();
  await supabase.from("announcements").insert({
    kind: readKind(formData),
    title,
    body: nullable(formData.get("body")),
    link_url: nullable(formData.get("link_url")),
    is_published: formData.get("is_published") === "on",
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
}

export async function updateAnnouncement(formData: FormData) {
  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  if (!id || !title) return;
  const supabase = createClient();
  await supabase
    .from("announcements")
    .update({
      kind: readKind(formData),
      title,
      body: nullable(formData.get("body")),
      link_url: nullable(formData.get("link_url")),
      is_published: formData.get("is_published") === "on",
    })
    .eq("id", id);
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
}

export async function deleteAnnouncement(formData: FormData) {
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("announcements").delete().eq("id", id);
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
}

// Set just the category on one row (the always-visible inline dropdown).
export async function setAnnouncementCategory(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("announcements").update({ kind: readKind(formData) }).eq("id", id);
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
}

// --- bulk actions: act on every ticked row at once -----------------------
function bulkIds(formData: FormData): string[] {
  return formData.getAll("ids").map(String).map((s) => s.trim()).filter(Boolean);
}

export async function bulkPublish(formData: FormData) {
  if (!(await isAdmin())) return;
  const ids = bulkIds(formData);
  if (ids.length) {
    await createServiceClient()
      .from("announcements")
      .update({ is_published: true, published_at: new Date().toISOString() })
      .in("id", ids);
  }
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
}

export async function bulkUnpublish(formData: FormData) {
  if (!(await isAdmin())) return;
  const ids = bulkIds(formData);
  if (ids.length) {
    await createServiceClient().from("announcements").update({ is_published: false }).in("id", ids);
  }
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
}

export async function bulkDelete(formData: FormData) {
  if (!(await isAdmin())) return;
  const ids = bulkIds(formData);
  if (ids.length) {
    await createServiceClient().from("announcements").delete().in("id", ids);
  }
  revalidatePath("/admin/announcements");
  revalidatePath("/admin/announcements/posts");
}
