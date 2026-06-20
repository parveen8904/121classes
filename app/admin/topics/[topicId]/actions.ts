"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../../_lib/util";
import { ALL_CONFIG_FIELDS } from "./sectionTypes";
import { summarizeClass } from "@/lib/ai";
import { extractPdfText } from "@/lib/pdf";
import { createServiceClient } from "@/lib/supabase/service";

// Attach AI-training material (question bank / ICAI / RTP / past papers / book)
// to a topic. PDF text is extracted ONCE so the AI is grounded on it for this
// topic's doubts, MCQs and descriptive questions.
export async function addTopicMaterial(formData: FormData) {
  const topicId = str(formData.get("topicId"));
  const subjectId = str(formData.get("subjectId")) || null;
  const title = str(formData.get("title"));
  const kind = str(formData.get("kind")) || "other";
  const fileUrl = str(formData.get("file_url")) || null;
  let content = str(formData.get("content"));
  if (!topicId || (!fileUrl && !content)) return;
  if (!content && fileUrl && /\.pdf($|\?)/i.test(fileUrl)) {
    const ex = await extractPdfText(fileUrl);
    if (ex) content = ex;
  }
  await createServiceClient().from("repository_items").insert({
    title: title || kind,
    kind,
    topic_id: topicId,
    subject_id: subjectId,
    file_url: fileUrl,
    content,
    is_active: true,
  });
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function deleteTopicMaterial(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("topicId"));
  if (!id) return;
  await createServiceClient().from("repository_items").delete().eq("id", id);
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

// ---- Automatic class numbering -------------------------------------------
// Classes are numbered by their order, not typed. After any class is added,
// edited (order changed) or removed, we renumber every class in the subject:
//   topic class no = position within the topic (1,2,3…)
//   class no       = running position across the whole subject (1…N)
// and rebuild each class's unique number. Topics run in their order_index, so
// topic 1 gets classes 1–7, topic 2 gets 8–12, and so on.
function cleanCode(s: string) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function padNum(n: number, width: number) {
  return String(n).padStart(width, "0").slice(-width);
}
function yymmOf(taughtOn: unknown) {
  const d = String(taughtOn ?? "");
  return d.length >= 7 ? d.slice(2, 4) + d.slice(5, 7) : "";
}

async function resequenceSubjectClasses(subjectId: string) {
  const svc = createServiceClient();
  const { data: subject } = await svc.from("subjects").select("code").eq("id", subjectId).maybeSingle();
  const subCode = cleanCode((subject as { code?: string } | null)?.code ?? "");
  const { data: tps } = await svc
    .from("topics")
    .select("id, order_index, title, topic_code")
    .eq("subject_id", subjectId)
    .order("order_index")
    .order("title");
  const topicList = tps ?? [];
  const topicIds = topicList.map((t) => t.id);
  if (!topicIds.length) return;

  const { data: secs } = await svc
    .from("sections")
    .select("id, topic_id, order_index, title, created_at, config")
    .in("topic_id", topicIds)
    .eq("type", "full_class_video");
  const byTopic = new Map<string, { id: string; order_index: number; title: string; created_at: string; config: Record<string, unknown> | null }[]>();
  for (const s of secs ?? []) {
    const row = s as { id: string; topic_id: string; order_index: number; title: string; created_at: string; config: Record<string, unknown> | null };
    if (!byTopic.has(row.topic_id)) byTopic.set(row.topic_id, []);
    byTopic.get(row.topic_id)!.push({ id: row.id, order_index: row.order_index, title: row.title, created_at: row.created_at, config: row.config });
  }

  let classNo = 0;
  const updates: { id: string; config: Record<string, unknown> }[] = [];
  for (const t of topicList) {
    const topCode = cleanCode((t as { topic_code?: string }).topic_code ?? "");
    // Order field first; classes with the same order keep their creation order.
    const list = (byTopic.get(t.id) ?? []).sort(
      (a, b) => a.order_index - b.order_index || String(a.created_at).localeCompare(String(b.created_at)),
    );
    let topicClassNo = 0;
    for (const s of list) {
      classNo++;
      topicClassNo++;
      const cfg = (s.config ?? {}) as Record<string, unknown>;
      const ym = yymmOf(cfg.taught_on);
      const class_number = subCode && topCode && ym ? `${subCode}${ym}${topCode}${padNum(topicClassNo, 2)}${padNum(classNo, 3)}` : "";
      updates.push({ id: s.id, config: { ...cfg, class_no: String(classNo), topic_class_no: String(topicClassNo), class_number } });
    }
  }
  // One write per class (config is per-row); small N, runs only on edits.
  for (const u of updates) {
    await svc.from("sections").update({ config: u.config }).eq("id", u.id);
  }
}

async function resequenceForTopic(topicId: string) {
  const svc = createServiceClient();
  const { data: t } = await svc.from("topics").select("subject_id").eq("id", topicId).maybeSingle();
  const sid = (t as { subject_id?: string } | null)?.subject_id;
  if (sid) await resequenceSubjectClasses(sid);
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
  const title = str(formData.get("title"));
  const supabase = createClient();
  await supabase
    .from("topics")
    .update({
      // keep the existing name if the field is left blank
      ...(title ? { title } : {}),
      // short code: uppercase, alphanumeric only, capped at 6 chars
      topic_code: str(formData.get("topic_code")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || null,
      weightage_marks: str(formData.get("weightage_marks")) ? num(formData.get("weightage_marks")) : null,
      importance: parseImportance(str(formData.get("importance"))),
      valid_from_attempt: nn("valid_from_attempt"),
      valid_to_attempt: nn("valid_to_attempt"),
      amendments_upto: nn("amendments_upto"),
      important_qs_rev1: nn("important_qs_rev1"),
      important_qs_rev2: nn("important_qs_rev2"),
      update_coming: formData.get("update_coming") === "on",
      update_on: nn("update_on"),
      update_for: nn("update_for"),
      update_note: nn("update_note"),
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
        ai_questions_discussed: result.questions_discussed.join("\n"),
        ai_concepts_discussed: result.concepts_discussed.join("\n"),
        ai_homework_count: result.homework_covered_count,
        ai_homework_next: result.homework_next,
      },
    })
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
  if (type === "full_class_video") await resequenceForTopic(topicId);
  revalidatePath(`/admin/topics/${topicId}`);
}

export async function updateSection(formData: FormData) {
  const id = str(formData.get("id"));
  const topicId = str(formData.get("topicId"));
  const title = str(formData.get("title"));
  const type = str(formData.get("type"));
  if (!id || !title || !type) return;
  const supabase = createClient();
  // Preserve AI-generated keys (class summary, auto-assigned numbers) that the
  // form doesn't carry, so editing a class doesn't wipe them.
  const { data: prev } = await supabase.from("sections").select("config").eq("id", id).maybeSingle();
  const prevCfg = (prev?.config ?? {}) as Record<string, unknown>;
  const preserved: Record<string, unknown> = {};
  for (const k of Object.keys(prevCfg)) {
    if (k.startsWith("ai_") || k === "class_no" || k === "topic_class_no" || k === "class_number") preserved[k] = prevCfg[k];
  }
  await supabase
    .from("sections")
    .update({
      type,
      title,
      order_index: num(formData.get("order_index")),
      min_plan: readMinPlan(formData),
      config: { ...preserved, ...readConfig(formData) },
      is_published: formData.get("is_published") === "on",
    })
    .eq("id", id);
  if (type === "full_class_video") await resequenceForTopic(topicId);
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
  // Renumber the remaining classes so the sequence stays continuous.
  if (topicId) await resequenceForTopic(topicId);
  revalidatePath(`/admin/topics/${topicId}`);
  redirect(`/admin/topics/${topicId}`);
}
