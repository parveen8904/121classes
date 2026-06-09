"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../_lib/util";

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
