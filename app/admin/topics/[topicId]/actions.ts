"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";
import { ALL_CONFIG_FIELDS } from "./sectionTypes";

function readConfig(formData: FormData): Record<string, string> {
  const config: Record<string, string> = {};
  for (const f of ALL_CONFIG_FIELDS) {
    const v = str(formData.get(f));
    if (v) config[f] = v;
  }
  return config;
}

function readMinPlan(formData: FormData): string | null {
  const v = str(formData.get("min_plan"));
  return v === "bronze" || v === "silver" || v === "gold" ? v : null;
}

export async function createSection(formData: FormData) {
  const topicId = str(formData.get("topicId"));
  const title = str(formData.get("title"));
  const type = str(formData.get("type"));
  if (!topicId || !title || !type) return;
  const supabase = createClient();
  await supabase.from("sections").insert({
    topic_id: topicId,
    type,
    title,
    order_index: num(formData.get("order_index")),
    min_plan: readMinPlan(formData),
    config: readConfig(formData),
    is_published: formData.get("is_published") === "on",
  });
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function updateSection(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("topicId"));
  const title = str(formData.get("title"));
  const type = str(formData.get("type"));
  if (!id || !title || !type) return;
  const supabase = createClient();
  await supabase
    .from("sections")
    .update({
      type,
      title,
      order_index: num(formData.get("order_index")),
      min_plan: readMinPlan(formData),
      config: readConfig(formData),
      is_published: formData.get("is_published") === "on",
    })
    .eq("id", id);
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function toggleSectionPublish(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("topicId"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("sections").update({ is_published: next }).eq("id", id);
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function deleteSection(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("sections").delete().eq("id", id);
  revalidatePath(`/admin/topics/${topicId}`);
  redirect(`/admin/topics/${topicId}`);
}
