"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num, nullable } from "../_lib/util";

function fields(formData: FormData) {
  return {
    student_name: str(formData.get("student_name")),
    headline: nullable(formData.get("headline")),
    attempt: nullable(formData.get("attempt")),
    marks: nullable(formData.get("marks")),
    quote: nullable(formData.get("quote")),
    photo_url: nullable(formData.get("photo_url")),
    order_index: num(formData.get("order_index")),
    is_published: formData.get("is_published") === "on",
  };
}

export async function createResult(formData: FormData) {
  const f = fields(formData);
  if (!f.student_name) return;
  const supabase = createClient();
  await supabase.from("results").insert(f);
  revalidatePath("/admin/results");
  revalidatePath("/results");
  revalidatePath("/");
}

export async function updateResult(formData: FormData) {
  const id = str(formData.get("id"));
  const f = fields(formData);
  if (!id || !f.student_name) return;
  const supabase = createClient();
  await supabase.from("results").update(f).eq("id", id);
  revalidatePath("/admin/results");
  revalidatePath("/results");
  revalidatePath("/");
}

export async function deleteResult(formData: FormData) {
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("results").delete().eq("id", id);
  revalidatePath("/admin/results");
  revalidatePath("/results");
  revalidatePath("/");
}
