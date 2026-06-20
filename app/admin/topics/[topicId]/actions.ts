"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";
import { ALL_CONFIG_FIELDS } from "./sectionTypes";
import { summarizeClass, transcribeHandwriting, draftTopicQuestions, draftClassContent } from "@/lib/ai";
import { notifyFaculty } from "@/lib/notify";

// AI-draft the topic's first/second-revision important questions (editable).
export async function aiDraftTopic(formData: FormData) {
  const topicId = str(formData.get("topicId"));
  if (!topicId) return;
  const supabase = createClient();
  const { data: t } = await supabase.from("topics").select("title, subjects(title)").eq("id", topicId).maybeSingle();
  if (!t) return;
  const subject = (t as { subjects?: { title?: string } | null }).subjects?.title ?? "";
  // Ground on any class transcripts already entered for this topic.
  const { data: secs } = await supabase.from("sections").select("config").eq("topic_id", topicId);
  const material = (secs ?? []).map((s) => String(((s.config ?? {}) as Record<string, unknown>).transcript ?? "")).filter(Boolean).join("\n\n").slice(0, 8000);
  const draft = await draftTopicQuestions(subject, t.title, material || undefined);
  if (!draft) return;
  await supabase.from("topics").update({ important_qs_rev1: draft.rev1.join("\n"), important_qs_rev2: draft.rev2.join("\n") }).eq("id", topicId);
  revalidatePath(`/admin/topics/${topicId}`);
}

// AI-draft a class's transcript (from handwritten notes), concepts, questions
// and homework — all editable afterwards.
export async function aiDraftClass(formData: FormData) {
  const sectionId = str(formData.get("sectionId"));
  const topicId = str(formData.get("topicId"));
  if (!sectionId) return;
  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("config").eq("id", sectionId).maybeSingle();
  const config = (sec?.config ?? {}) as Record<string, unknown>;
  let transcript = String(config.transcript ?? "");
  // If no transcript yet, OCR the handwritten notes PDF to get the material.
  if (transcript.trim().length < 50 && config.notes_hand_url) {
    const ocr = await transcribeHandwriting(String(config.notes_hand_url));
    if (ocr) transcript = ocr;
  }
  if (transcript.trim().length < 50) return;
  const draft = await draftClassContent(transcript);
  if (!draft) return;
  await supabase
    .from("sections")
    .update({
      config: {
        ...config,
        transcript,
        important_concepts: draft.concepts.join("\n"),
        important_questions: draft.questions.join("\n"),
        homework: config.homework || draft.homework,
        ai_summary: draft.summary,
        ai_key_points: draft.concepts.join("\n"),
      },
    })
    .eq("id", sectionId);
  revalidatePath(`/admin/topics/${topicId}`);
}

function readConfig(formData: FormData): Record<string, string> {
  const config: Record<string, string> = {};
  for (const f of ALL_CONFIG_FIELDS) {
    const v = str(formData.get(f));
    if (v) config[f] = v;
  }
  return config;
}

function readMinPlan(formData: FormData): string | null {
  const v = str(formData.get("min_plan"));
  return v === "bronze" || v === "silver" || v === "gold" ? v : null;
}

// "Hit list" importance per attempt: lines of "attempt | category" → object.
function parseImportance(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [att, cat] = line.split("|").map((s) => s.trim());
    if (att && cat) out[att] = cat.toUpperCase();
  }
  return out;
}

// Topic-level repository metadata (weightage, applicability, hit-list
// importance, important questions, revision/ICAI materials, "updated content
// coming" notice, and the combined-topic flag + subject-wide materials).
export async function updateTopicMeta(formData: FormData) {
  const topicId = str(formData.get("topicId"));
  if (!topicId) return;
  const nn = (k: string) => str(formData.get(k)) || null;
  const supabase = createClient();
  await supabase
    .from("topics")
    .update({
      weightage_marks: str(formData.get("weightage_marks")) ? num(formData.get("weightage_marks")) : null,
      importance: parseImportance(str(formData.get("importance"))),
      valid_from_attempt: nn("valid_from_attempt"),
      valid_to_attempt: nn("valid_to_attempt"),
      amendments_upto: nn("amendments_upto"),
      important_qs_rev1: nn("important_qs_rev1"),
      important_qs_rev2: nn("important_qs_rev2"),
      book_pdf_url: nn("book_pdf_url"),
      icai_material_url: nn("icai_material_url"),
      revision_video_url: nn("revision_video_url"),
      revision_notes_hand_url: nn("revision_notes_hand_url"),
      revision_notes_typed_url: nn("revision_notes_typed_url"),
      update_coming: formData.get("update_coming") === "on",
      update_on: nn("update_on"),
      update_for: nn("update_for"),
      update_note: nn("update_note"),
      is_combined: formData.get("is_combined") === "on",
      revision_paper_url: nn("revision_paper_url"),
      amendments_pdf_url: nn("amendments_pdf_url"),
    })
    .eq("id", topicId);
  revalidatePath(`/admin/topics/${topicId}`);
}

// Per-class duration (minutes) used by the study planner. Stored in
// site_settings under dur:<topicId>.
export async function setClassDuration(formData: FormData) {
  const topicId = str(formData.get("topicId"));
  if (!topicId) return;
  const minutes = num(formData.get("minutes"));
  const supabase = createClient();
  if (minutes > 0) {
    await supabase.from("site_settings").upsert({ key: `dur:${topicId}`, value: String(minutes) }, { onConflict: "key" });
  } else {
    await supabase.from("site_settings").delete().eq("key", `dur:${topicId}`);
  }
  revalidatePath(`/admin/topics/${topicId}`);
}

// Read a class section's transcript and store an AI summary (overview, number
// of questions solved, homework, key concepts) on the section config.
export async function summarizeClassSection(formData: FormData) {
  const sectionId = str(formData.get("sectionId"));
  const topicId = str(formData.get("topicId"));
  if (!sectionId) return;
  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("config").eq("id", sectionId).maybeSingle();
  const config = (sec?.config ?? {}) as Record<string, unknown>;
  const transcript = String(config.transcript ?? "");
  if (transcript.trim().length < 50) return;
  const result = await summarizeClass(transcript);
  if (!result) return;
  await supabase
    .from("sections")
    .update({
      config: {
        ...config,
        ai_summary: result.summary,
        ai_questions_count: result.questions_count,
        ai_homework: result.homework,
        ai_key_points: result.key_points.join("\n"),
      },
    })
    .eq("id", sectionId);
  revalidatePath(`/admin/topics/${topicId}`);
}

// Convert a class's handwritten notes to typed notes (AI) and send to faculty
// for approval. The typed notes stay hidden from students until approved.
export async function convertHandwrittenNotes(formData: FormData) {
  const sectionId = str(formData.get("sectionId"));
  const topicId = str(formData.get("topicId"));
  if (!sectionId) return;
  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("title, config").eq("id", sectionId).maybeSingle();
  const config = (sec?.config ?? {}) as Record<string, unknown>;
  const hand = String(config.notes_hand_url ?? "");
  if (!hand) return;
  const typed = await transcribeHandwriting(hand);
  if (!typed) return;
  await supabase
    .from("sections")
    .update({ config: { ...config, notes_typed_pending: typed, notes_typed_status: "pending" } })
    .eq("id", sectionId);
  // Share the converted notes with faculty for approval.
  await notifyFaculty(
    `Typed notes need approval — ${sec?.title ?? "class"}`,
    `AI converted the handwritten notes for "${sec?.title ?? "a class"}" into typed notes. ` +
      `Please review and approve at Admin → Topics → this class.\n\n--- Converted notes ---\n\n${typed.slice(0, 6000)}`,
  );
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function approveTypedNotes(formData: FormData) {
  const sectionId = str(formData.get("sectionId"));
  const topicId = str(formData.get("topicId"));
  if (!sectionId) return;
  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("config").eq("id", sectionId).maybeSingle();
  const config = (sec?.config ?? {}) as Record<string, unknown>;
  const pending = String(config.notes_typed_pending ?? "");
  if (!pending) return;
  const { notes_typed_pending: _omit, ...rest } = config;
  void _omit;
  await supabase
    .from("sections")
    .update({ config: { ...rest, notes_typed_text: pending, notes_typed_status: "approved" } })
    .eq("id", sectionId);
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function rejectTypedNotes(formData: FormData) {
  const sectionId = str(formData.get("sectionId"));
  const topicId = str(formData.get("topicId"));
  if (!sectionId) return;
  const supabase = createClient();
  const { data: sec } = await supabase.from("sections").select("config").eq("id", sectionId).maybeSingle();
  const config = (sec?.config ?? {}) as Record<string, unknown>;
  const { notes_typed_pending: _omit, ...rest } = config;
  void _omit;
  await supabase
    .from("sections")
    .update({ config: { ...rest, notes_typed_status: "rejected" } })
    .eq("id", sectionId);
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function createSection(formData: FormData) {
  const topicId = str(formData.get("topicId"));
  const title = str(formData.get("title"));
  const type = str(formData.get("type"));
  if (!topicId || !title || !type) return;
  const supabase = createClient();
  await supabase.from("sections").insert({
    topic_id: topicId,
    type,
    title,
    order_index: num(formData.get("order_index")),
    min_plan: readMinPlan(formData),
    config: readConfig(formData),
    is_published: formData.get("is_published") === "on",
  });
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function updateSection(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("topicId"));
  const title = str(formData.get("title"));
  const type = str(formData.get("type"));
  if (!id || !title || !type) return;
  const supabase = createClient();
  await supabase
    .from("sections")
    .update({
      type,
      title,
      order_index: num(formData.get("order_index")),
      min_plan: readMinPlan(formData),
      config: readConfig(formData),
      is_published: formData.get("is_published") === "on",
    })
    .eq("id", id);
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function toggleSectionPublish(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("topicId"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("sections").update({ is_published: next }).eq("id", id);
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function deleteSection(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("sections").delete().eq("id", id);
  revalidatePath(`/admin/topics/${topicId}`);
  redirect(`/admin/topics/${topicId}`);
}
