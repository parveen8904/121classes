"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify, str, num } from "../_lib/util";
import { assertArea } from "@/lib/adminAccess";

export async function createCourse(formData: FormData) {
  await assertArea(null);
  const title = str(formData.get("title"));
  if (!title) return;
  const supabase = createClient();
  await supabase.from("courses").insert({
    title,
    slug: str(formData.get("slug")) || slugify(title),
    order_index: num(formData.get("order_index")),
    is_published: formData.get("is_published") === "on",
    is_test_series: formData.get("is_test_series") === "on",
  });
  revalidatePath("/admin/courses");
}

export async function updateCourse(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  if (!id || !title) return;
  const supabase = createClient();
  await supabase
    .from("courses")
    .update({
      title,
      slug: str(formData.get("slug")) || slugify(title),
      order_index: num(formData.get("order_index")),
      is_published: formData.get("is_published") === "on",
      is_test_series: formData.get("is_test_series") === "on",
    })
    .eq("id", id);
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${id}`);
}

export async function toggleCoursePublish(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("courses").update({ is_published: next }).eq("id", id);
  revalidatePath("/admin/courses");
}

export async function deleteCourse(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("courses").delete().eq("id", id);
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}
