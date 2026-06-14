"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";
import { generateSubjectiveQuestions } from "@/lib/ai";

// Generate descriptive questions from a transcript via AI, once, and store them.
export async function generateSubjectiveFromTranscript(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const transcript = str(formData.get("transcript"));
  const count = num(formData.get("count")) || 5;
  const topic = str(formData.get("topic"));
  if (!sectionId || transcript.length < 50) return;

  const items = await generateSubjectiveQuestions(transcript, count, topic || undefined);
  if (!items || items.length === 0) return;

  const supabase = createClient();
  await supabase.from("subjective_questions").insert(
    items.map((q) => ({ section_id: sectionId, prompt: q.prompt, max_marks: q.max_marks })),
  );
  revalidatePath(`/admin/subjective/${sectionId}`);
}

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
