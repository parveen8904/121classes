"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify, str, num } from "../../_lib/util";
import { assertArea } from "@/lib/adminAccess";

export async function createSubject(formData: FormData) {
  await assertArea(null);
  const courseId = str(formData.get("courseId"));
  const title = str(formData.get("title"));
  if (!courseId || !title) return;
  const supabase = createClient();
  await supabase.from("subjects").insert({
    course_id: courseId,
    title,
    slug: str(formData.get("slug")) || slugify(title),
    order_index: num(formData.get("order_index")),
  });
  revalidatePath(`/admin/courses/${courseId}`);
}

export async function updateSubject(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const courseId = str(formData.get("courseId"));
  const title = str(formData.get("title"));
  if (!id || !title) return;
  const supabase = createClient();
  await supabase
    .from("subjects")
    .update({
      title,
      slug: str(formData.get("slug")) || slugify(title),
      order_index: num(formData.get("order_index")),
    })
    .eq("id", id);
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/subjects/${id}`);
}

export async function deleteSubject(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const courseId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("subjects").delete().eq("id", id);
  revalidatePath(`/admin/courses/${courseId}`);
  redirect(`/admin/courses/${courseId}`);
}
