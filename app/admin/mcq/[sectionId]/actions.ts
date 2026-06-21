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
        concept: q.concept || null,
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

// "2 MCQs per class for the whole topic" — the standard chapter test. Runs once
// (AI), tagging each question with its source class + concept; stored statically.
export async function generateChapterTest(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  if (!sectionId) return;
  const replace = formData.get("replace") === "on";
  // Each topic test has 10–30 questions; admin chooses the number (default 20).
  const target = Math.max(10, Math.min(30, num(formData.get("count")) || 20));
  const supabase = createClient();

  const { data: sec } = await supabase.from("sections").select("topic_id, topics(title), config").eq("id", sectionId).maybeSingle();
  const topicId = (sec as { topic_id?: string } | null)?.topic_id;
  const topicTitle = (sec as { topics?: { title?: string } | null } | null)?.topics?.title ?? "";
  if (!topicId) return;

  const { data: classes } = await supabase
    .from("sections")
    .select("config")
    .eq("topic_id", topicId)
    .eq("type", "full_class_video")
    .eq("is_published", true)
    .order("order_index");
  const blocks = (classes ?? [])
    .map((c) => (c.config ?? {}) as Record<string, unknown>)
    .filter((cf) => String(cf.ai_summary ?? "").trim() || String(cf.transcript ?? "").trim());
  if (!blocks.length) return;

  // Spread `target` questions across the classes (a few per class), then pick
  // round-robin so every class is represented up to the chosen total.
  const perClass = Math.max(1, Math.min(8, Math.ceil(target / blocks.length)));
  type Item = Awaited<ReturnType<typeof generateMcqs>> extends (infer U)[] | null ? U : never;
  const genByClass: { classNo: string; items: NonNullable<Item>[] }[] = [];
  for (const cf of blocks) {
    const classNo = String(cf.class_no ?? cf.topic_class_no ?? "");
    const ctx = [
      cf.ai_summary ? `Summary:\n${cf.ai_summary}` : "",
      cf.ai_concepts_discussed ? `Concepts:\n${cf.ai_concepts_discussed}` : "",
      cf.ai_questions_discussed ? `Questions covered:\n${cf.ai_questions_discussed}` : "",
      !cf.ai_summary && cf.transcript ? String(cf.transcript).slice(0, 12000) : "",
    ].filter(Boolean).join("\n\n");
    if (ctx.length < 30) continue;
    const items = await generateMcqs(ctx, perClass, topicTitle || undefined);
    if (items && items.length) genByClass.push({ classNo, items: items as NonNullable<Item>[] });
  }
  if (!genByClass.length) return;

  const selected: { classNo: string; q: NonNullable<Item> }[] = [];
  for (let i = 0; selected.length < target; i++) {
    let added = false;
    for (const g of genByClass) {
      if (g.items[i]) {
        selected.push({ classNo: g.classNo, q: g.items[i] });
        added = true;
        if (selected.length >= target) break;
      }
    }
    if (!added) break;
  }
  if (!selected.length) return;

  if (replace) await supabase.from("mcq_questions").delete().eq("section_id", sectionId);
  let base = 0;
  if (!replace) {
    const { count } = await supabase.from("mcq_questions").select("id", { count: "exact", head: true }).eq("section_id", sectionId);
    base = count ?? 0;
  }

  const { data: inserted } = await supabase
    .from("mcq_questions")
    .insert(
      selected.map((s, i) => ({
        section_id: sectionId,
        question: s.q.question,
        options: s.q.options,
        correct_index: s.q.correct_index,
        order_index: base + i,
        concept: s.q.concept || null,
        source_class_no: s.classNo || null,
      })),
    )
    .select("id, order_index");

  const byOrder = new Map(selected.map((s, i) => [base + i, s.q]));
  for (const r of inserted ?? []) {
    const it = byOrder.get(r.order_index);
    if (it) await saveMcqExplanation(r.id, it.why_correct, it.why_wrong);
  }

  // Remember the chosen count on the section.
  const cfg = ((sec as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
  await supabase.from("sections").update({ config: { ...cfg, question_count: target } }).eq("id", sectionId);
  revalidatePath(`/admin/mcq/${sectionId}`);
}

export async function deleteMcq(formData: FormData) {
  const id = str(formData.get("id"));
  const sectionId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("mcq_questions").delete().eq("id", id);
  revalidatePath(`/admin/mcq/${sectionId}`);
}
