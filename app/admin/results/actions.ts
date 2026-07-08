"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { str, num, nullable } from "../_lib/util";

function fields(formData: FormData) {
  return {
    student_name: str(formData.get("student_name")),
    headline: nullable(formData.get("headline")),
    attempt: nullable(formData.get("attempt")),
    marks: nullable(formData.get("marks")),
    quote: nullable(formData.get("quote")),
    photo_url: nullable(formData.get("photo_url")),
    level: nullable(formData.get("level")),
    order_index: num(formData.get("order_index")),
    is_published: formData.get("is_published") === "on",
  };
}

export async function createResult(formData: FormData) {
  if (!(await requireArea("results"))) return;
  const f = fields(formData);
  if (!f.student_name) return;
  const supabase = createServiceClient();
  await supabase.from("results").insert(f);
  revalidatePath("/admin/results");
  revalidatePath("/results");
  revalidatePath("/courses");
  revalidatePath("/");
}

export async function updateResult(formData: FormData) {
  if (!(await requireArea("results"))) return;
  const id = str(formData.get("id"));
  const f = fields(formData);
  if (!id || !f.student_name) return;
  const supabase = createServiceClient();
  await supabase.from("results").update(f).eq("id", id);
  revalidatePath("/admin/results");
  revalidatePath("/results");
  revalidatePath("/courses");
  revalidatePath("/");
}

export async function deleteResult(formData: FormData) {
  if (!(await requireArea("results"))) return;
  const id = str(formData.get("id"));
  const supabase = createServiceClient();
  await supabase.from("results").delete().eq("id", id);
  revalidatePath("/admin/results");
  revalidatePath("/results");
  revalidatePath("/courses");
  revalidatePath("/");
}
