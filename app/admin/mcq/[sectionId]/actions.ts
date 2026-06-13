"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";

export async function addMcq(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const question = str(formData.get("question"));
  if (!sectionId || !question) return;

  const raw = [
    str(formData.get("opt0")),
    str(formData.get("opt1")),
    str(formData.get("opt2")),
    str(formData.get("opt3")),
  ];
  const correctPos = num(formData.get("correct"), 0); // 0-based into raw

  const options: string[] = [];
  let correctIndex = 0;
  raw.forEach((o, i) => {
    if (o) {
      if (i === correctPos) correctIndex = options.length;
      options.push(o);
    }
  });
  if (options.length < 2) return;

  const supabase = createClient();
  const { count } = await supabase
    .from("mcq_questions")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);

  await supabase.from("mcq_questions").insert({
    section_id: sectionId,
    question,
    options,
    correct_index: correctIndex,
    order_index: count ?? 0,
  });
  revalidatePath(`/admin/mcq/${sectionId}`);
}

export async function deleteMcq(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("mcq_questions").delete().eq("id", id);
  revalidatePath(`/admin/mcq/${sectionId}`);
}
