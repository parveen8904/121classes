"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { str, num } from "../_lib/util";

export async function createProtectedVideo(formData: FormData) {
  const title = str(formData.get("title"));
  const storage_url = str(formData.get("storage_url"));
  const key_b64 = str(formData.get("key_b64"));
  if (!title || !storage_url || !key_b64) return;

  const minPlan = str(formData.get("min_plan"));
  const svc = createServiceClient();
  await svc.from("protected_videos").insert({
    title,
    subject_id: str(formData.get("subject_id")) || null,
    min_plan: minPlan === "silver" || minPlan === "bronze" ? minPlan : "gold",
    storage_url,
    key_b64,
    iv_b64: str(formData.get("iv_b64")) || null,
    alg: str(formData.get("alg")) || "aes-256-cbc",
    byte_size: num(formData.get("byte_size")) || null,
    is_published: formData.get("is_published") === "on",
  });
  revalidatePath("/admin/protected");
}

export async function deleteProtectedVideo(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  await svc.from("protected_videos").delete().eq("id", id);
  revalidatePath("/admin/protected");
}
