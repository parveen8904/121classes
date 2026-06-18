"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

const orNull = (v: FormDataEntryValue | null) => str(v).trim() || null;

export async function addRepositoryItem(formData: FormData) {
  if (!(await requireAdmin())) return;
  const title = str(formData.get("title")).trim();
  if (!title) return;
  const svc = createServiceClient();
  await svc.from("repository_items").insert({
    title,
    kind: str(formData.get("kind")) || "transcript",
    subject_id: orNull(formData.get("subject_id")),
    course_id: orNull(formData.get("course_id")),
    file_url: orNull(formData.get("file_url")),
    content: orNull(formData.get("content")),
    valid_from: orNull(formData.get("valid_from")),
    valid_to: orNull(formData.get("valid_to")),
    valid_from_attempt: orNull(formData.get("valid_from_attempt")),
  });
  revalidatePath("/admin/repository");
}

export async function deleteRepositoryItem(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("repository_items").delete().eq("id", id);
  revalidatePath("/admin/repository");
}

export async function toggleRepositoryItem(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!id) return;
  await createServiceClient().from("repository_items").update({ is_active: active }).eq("id", id);
  revalidatePath("/admin/repository");
}
