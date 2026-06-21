"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num, nullable } from "../_lib/util";

function payload(formData: FormData) {
  return {
    course_id: str(formData.get("course_id")) || null,
    subject_id: str(formData.get("subject_id")) || null,
    topic_id: str(formData.get("topic_id")) || null,
    order_index: num(formData.get("order_index")),
    title: str(formData.get("title")),
    body: nullable(formData.get("body")),
    bunny_video_id: nullable(formData.get("bunny_video_id")),
    bunny_drm: nullable(formData.get("bunny_drm")),
    youtube_url: nullable(formData.get("youtube_url")),
    embed_url: nullable(formData.get("embed_url")),
    notes_hand_url: nullable(formData.get("notes_hand_url")),
    discussion: nullable(formData.get("discussion")),
    valid_from_attempt: nullable(formData.get("valid_from_attempt")),
    valid_to_attempt: nullable(formData.get("valid_to_attempt")),
    is_published: formData.get("is_published") === "on",
  };
}

export async function createAmendment(formData: FormData) {
  const p = payload(formData);
  if (!p.title) return;
  await createClient().from("amendments").insert(p);
  revalidatePath("/admin/amendments");
}

export async function updateAmendment(formData: FormData) {
  const id = str(formData.get("id"));
  const p = payload(formData);
  if (!id || !p.title) return;
  await createClient().from("amendments").update(p).eq("id", id);
  revalidatePath("/admin/amendments");
}

export async function deleteAmendment(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  await createClient().from("amendments").delete().eq("id", id);
  revalidatePath("/admin/amendments");
}
