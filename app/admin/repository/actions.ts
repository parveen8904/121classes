"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractPdfText } from "@/lib/pdf";
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
  const fileUrl = orNull(formData.get("file_url"));
  let content = orNull(formData.get("content"));

  // Auto-extract text from an uploaded PDF when no text was pasted.
  if (!content && fileUrl && /\.pdf($|\?)/i.test(fileUrl)) {
    const extracted = await extractPdfText(fileUrl);
    if (extracted) content = extracted;
  }

  // Only a PDF can be shared on the public Resources page.
  const shareToResources = formData.get("share_to_resources") === "on" && !!fileUrl && /\.pdf($|\?)/i.test(fileUrl);

  const svc = createServiceClient();
  await svc.from("repository_items").insert({
    title,
    kind: str(formData.get("kind")) || "transcript",
    subject_id: orNull(formData.get("subject_id")),
    course_id: orNull(formData.get("course_id")),
    file_url: fileUrl,
    content,
    valid_from: orNull(formData.get("valid_from")),
    valid_to: orNull(formData.get("valid_to")),
    valid_from_attempt: orNull(formData.get("valid_from_attempt")),
    share_to_resources: shareToResources,
    resource_label: shareToResources ? (str(formData.get("resource_label")) || title) : null,
  });
  revalidatePath("/admin/repository");
  revalidatePath("/resources");
}

// Re-extract text from an item's PDF (for file-only items, or to refresh).
export async function extractItemText(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: item } = await svc.from("repository_items").select("file_url").eq("id", id).maybeSingle();
  if (item?.file_url) {
    const text = await extractPdfText(item.file_url);
    if (text) await svc.from("repository_items").update({ content: text }).eq("id", id);
  }
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
