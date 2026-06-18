"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";
import { generateMcqs } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { saveMcqExplanation } from "@/lib/answers";

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

// Generate MCQs from a pasted transcript via AI, ONCE, and store them.
// Students then take the test from stored questions — no per-student AI tokens.
export async function generateMcqsFromTranscript(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  let transcript = str(formData.get("transcript"));
  const count = num(formData.get("count")) || 10;
  const topic = str(formData.get("topic"));
  if (!sectionId) return;

  // Optionally generate from the AI Repository (this section's subject) instead
  // of a pasted transcript.
  if (formData.get("use_repo") === "on" && transcript.length < 50) {
    const supabase = createClient();
    const { data: sec } = await supabase.from("sections").select("topics(subject_id)").eq("id", sectionId).maybeSingle();
    const subjectId = (sec as { topics?: { subject_id?: string } | null } | null)?.topics?.subject_id ?? null;
    transcript = await getRepositoryContext(subjectId, 30000);
  }
  if (transcript.length < 50) return;

  const items = await generateMcqs(transcript, count, topic || undefined);
  if (!items || items.length === 0) return; // AI off or unparseable — insert nothing

  const supabase = createClient();

  // "Revise": replace the existing set instead of appending to it.
  if (formData.get("replace") === "on") {
    await supabase.from("mcq_questions").delete().eq("section_id", sectionId);
  }
  const { count: existing } = await supabase
    .from("mcq_questions")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);
  const base = existing ?? 0;

  const { data: inserted } = await supabase
    .from("mcq_questions")
    .insert(
      items.map((q, i) => ({
        section_id: sectionId,
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        order_index: base + i,
      })),
    )
    .select("id, order_index");

  // Save each question's "why correct / why each option" — ONCE — so reviews
  // need no further AI.
  const byOrder = new Map(items.map((q, i) => [base + i, q]));
  for (const r of inserted ?? []) {
    const it = byOrder.get(r.order_index);
    if (it) await saveMcqExplanation(r.id, it.why_correct, it.why_wrong);
  }
  revalidatePath(`/admin/mcq/${sectionId}`);
}

export async function deleteMcq(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("mcq_questions").delete().eq("id", id);
  revalidatePath(`/admin/mcq/${sectionId}`);
}
