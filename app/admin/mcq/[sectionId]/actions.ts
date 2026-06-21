"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num, nullable } from "../../_lib/util";
import { generateMcqs } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { saveMcqExplanation } from "@/lib/answers";

// Attach a reference PDF (question paper / answer key) to the test section.
export async function attachSectionPdf(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  if (!sectionId) return;
  const url = str(formData.get("pdf_url"));
  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("config").eq("id", sectionId).maybeSingle();
  const config = (sec?.config ?? {}) as Record<string, unknown>;
  await supabase.from("sections").update({ config: { ...config, pdf_url: url } }).eq("id", sectionId);
  revalidatePath(`/admin/mcq/${sectionId}`);
}

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

// Edit an existing question — text, options, correct answer, concept AND the
// per-option explanations (stored in site_settings). No AI.
export async function updateMcq(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("section_id"));
  const question = str(formData.get("question"));
  if (!id || !sectionId || !question) return;

  const correctPos = num(formData.get("correct"), 0); // 0..3 into the raw slots
  const options: string[] = [];
  const why: string[] = [];
  let correctIndex = 0;
  for (let i = 0; i < 4; i++) {
    const o = str(formData.get(`opt${i}`));
    if (o) {
      if (i === correctPos) correctIndex = options.length;
      options.push(o);
      why.push(str(formData.get(`why${i}`)));
    }
  }
  if (options.length < 2) return;

  const supabase = createClient();
  await supabase
    .from("mcq_questions")
    .update({ question, options, correct_index: correctIndex, concept: nullable(formData.get("concept")) })
    .eq("id", id);
  await saveMcqExplanation(id, str(formData.get("why_correct")), why);
  revalidatePath(`/admin/mcq/${sectionId}`);
}

// Bulk-add questions WITHOUT AI. Paste one question per block (blank line between
// blocks): first line = question, following lines = options, mark the correct one
// with a leading "*". Options may be prefixed "A)" etc.
export async function bulkAddMcq(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const raw = str(formData.get("bulk"));
  if (!sectionId || !raw) return;

  const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const parsed = blocks
    .map((b) => {
      const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 3) return null;
      const question = lines[0].replace(/^Q\s*[:.)-]\s*/i, "").trim();
      const options: string[] = [];
      let correctIndex = 0;
      for (const l of lines.slice(1)) {
        const isCorrect = /^\*/.test(l) || /\(correct\)\s*$/i.test(l);
        const text = l
          .replace(/^\*\s*/, "")
          .replace(/^[A-Da-d]\s*[).]\s*/, "")
          .replace(/\s*\(correct\)\s*$/i, "")
          .trim();
        if (text) {
          if (isCorrect) correctIndex = options.length;
          options.push(text);
        }
      }
      if (!question || options.length < 2) return null;
      return { question, options, correct_index: correctIndex };
    })
    .filter(Boolean) as { question: string; options: string[]; correct_index: number }[];
  if (!parsed.length) return;

  const supabase = createClient();
  const { count } = await supabase
    .from("mcq_questions")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId);
  const base = count ?? 0;
  await supabase.from("mcq_questions").insert(
    parsed.map((q, i) => ({
      section_id: sectionId,
      question: q.question,
      options: q.options,
      correct_index: q.correct_index,
      order_index: base + i,
    })),
  );
  revalidatePath(`/admin/mcq/${sectionId}`);
}

export async function deleteMcq(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("mcq_questions").delete().eq("id", id);
  revalidatePath(`/admin/mcq/${sectionId}`);
}
