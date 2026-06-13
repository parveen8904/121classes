"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";

export async function addSubjective(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const prompt = str(formData.get("prompt"));
  if (!sectionId || !prompt) return;
  const supabase = createClient();
  await supabase.from("subjective_questions").insert({
    section_id: sectionId,
    prompt,
    max_marks: num(formData.get("max_marks"), 10),
  });
  revalidatePath(`/admin/subjective/${sectionId}`);
}

export async function deleteSubjective(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("subjective_questions").delete().eq("id", id);
  revalidatePath(`/admin/subjective/${sectionId}`);
}
