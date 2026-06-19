"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";
import { generateSubjectiveQuestions } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";

// Marking scheme: one line per point, "point text | marks".
function parseRubric(raw: string): { point: string; marks: number }[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [p, m] = l.split("|").map((s) => s.trim());
      return { point: p, marks: Number(m) || 0 };
    });
}

// Generate descriptive questions from a transcript (or the AI Repository), once.
export async function generateSubjectiveFromTranscript(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  let transcript = str(formData.get("transcript"));
  const count = num(formData.get("count")) || 5;
  const topic = str(formData.get("topic"));
  if (!sectionId) return;

  if (formData.get("use_repo") === "on" && transcript.length < 50) {
    const supabase = createClient();
    const { data: sec } = await supabase.from("sections").select("topics(subject_id)").eq("id", sectionId).maybeSingle();
    const subjectId = (sec as { topics?: { subject_id?: string } | null } | null)?.topics?.subject_id ?? null;
    transcript = await getRepositoryContext(subjectId, 30000);
  }
  if (transcript.length < 50) return;

  const items = await generateSubjectiveQuestions(transcript, count, topic || undefined);
  if (!items || items.length === 0) return;

  const supabase = createClient();
  // "Revise": replace the existing set instead of appending to it.
  if (formData.get("replace") === "on") {
    await supabase.from("subjective_questions").delete().eq("section_id", sectionId);
  }
  // Save each question's model answer ONCE (no further AI at review time).
  await supabase
    .from("subjective_questions")
    .insert(items.map((q, i) => ({ section_id: sectionId, prompt: q.prompt, max_marks: q.max_marks, model_answer: q.model_answer, order_index: i })));
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
    level: str(formData.get("level")) || null,
    model_answer: str(formData.get("model_answer")) || null,
    rubric: parseRubric(str(formData.get("rubric"))),
  });
  revalidatePath(`/admin/subjective/${sectionId}`);
}

export async function updateSubjective(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("section_id"));
  const prompt = str(formData.get("prompt"));
  if (!id || !prompt) return;
  const supabase = createClient();
  await supabase
    .from("subjective_questions")
    .update({
      prompt,
      max_marks: num(formData.get("max_marks"), 10),
      level: str(formData.get("level")) || null,
      model_answer: str(formData.get("model_answer")) || null,
      rubric: parseRubric(str(formData.get("rubric"))),
    })
    .eq("id", id);
  revalidatePath(`/admin/subjective/${sectionId}`);
}

export async function deleteSubjective(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("subjective_questions").delete().eq("id", id);
  revalidatePath(`/admin/subjective/${sectionId}`);
}
