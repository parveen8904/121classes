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

// Pull new items now (also runs automatically on a schedule).
export async function fetchGovtFeedsNow() {
  if (!(await isAdmin())) return;
  const { added } = await ingestGovtFeeds();
  revalidatePath("/admin/announcements");
  redirect(`/admin/announcements?fetched=${added}`);
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
}

export async function deleteAnnouncement(formData: FormData) {
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("announcements").delete().eq("id", id);
  revalidatePath("/admin/announcements");
}
