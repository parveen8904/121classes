"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../_lib/util";

export async function createFaculty(formData: FormData) {
  const full_name = str(formData.get("full_name"));
  if (!full_name) return;
  const supabase = createClient();
  await supabase.from("faculties").insert({
    full_name,
    phone: nullable(formData.get("phone")),
    email: nullable(formData.get("email")),
    photo_url: nullable(formData.get("photo_url")),
    bio: nullable(formData.get("bio")),
  });
  revalidatePath("/admin/faculty");
}

export async function updateFaculty(formData: FormData) {
  const id = str(formData.get("id"));
  const full_name = str(formData.get("full_name"));
  if (!id || !full_name) return;
  const supabase = createClient();
  await supabase
    .from("faculties")
    .update({
      full_name,
      phone: nullable(formData.get("phone")),
      email: nullable(formData.get("email")),
      photo_url: nullable(formData.get("photo_url")),
      bio: nullable(formData.get("bio")),
    })
    .eq("id", id);
  revalidatePath("/admin/faculty");
}

export async function deleteFaculty(formData: FormData) {
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("faculties").delete().eq("id", id);
  revalidatePath("/admin/faculty");
}
