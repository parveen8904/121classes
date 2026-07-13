"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify, str, num, nullable } from "../../_lib/util";
import { normalizeWindow } from "@/app/learn/_lib/attempt";

export async function createTopic(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  const title = str(formData.get("title"));
  if (!subjectId || !title) return;
  const supabase = createClient();
  const { data: created } = await supabase.from("topics").insert({
    subject_id: subjectId,
    title,
    slug: str(formData.get("slug")) || slugify(title),
    order_index: num(formData.get("order_index")),
    // Applies from this attempt onward; end is always open (infinite).
    valid_from_attempt: nullable(formData.get("valid_from_attempt")),
    valid_to_attempt: null,
    amendments_upto: null,
    is_published: formData.get("is_published") === "on",
  }).select("id").single();
  // Auto-create the standard sections so a new topic is never blank.
  if (created?.id) {
    const { ensureGroupsForTopic } = await import("@/lib/sectionTemplate");
    await ensureGroupsForTopic(created.id as string);
  }
  revalidatePath(`/admin/subjects/${subjectId}`);
}

// One combined topic per subject (subject-wide mocks, amendments, past papers,
// full book). Placed after the regular topics.
export async function addCombinedTopic(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  if (!subjectId) return;
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("topics")
    .select("id")
    .eq("subject_id", subjectId)
    .eq("is_combined", true)
    .maybeSingle();
  if (existing) {
    revalidatePath(`/admin/subjects/${subjectId}`);
    redirect(`/admin/topics/${existing.id}`);
  }
  const { data: created } = await supabase
    .from("topics")
    .insert({ subject_id: subjectId, title: "Combined topic (whole subject)", slug: `combined-${subjectId.slice(0, 8)}`, order_index: 999, is_combined: true, is_published: false })
    .select("id")
    .single();
  revalidatePath(`/admin/subjects/${subjectId}`);
  if (created) redirect(`/admin/topics/${created.id}`);
}

export async function deleteTopic(formData: FormData) {
  const id = str(formData.get("id"));
  const subjectId = str(formData.get("parentId"));
  const supabase = createClient();
  await supabase.from("topics").delete().eq("id", id);
  revalidatePath(`/admin/subjects/${subjectId}`);
  redirect(`/admin/subjects/${subjectId}`);
}

export async function toggleTopicPublish(formData: FormData) {
  const id = str(formData.get("id"));
  const subjectId = str(formData.get("subjectId"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("topics").update({ is_published: next }).eq("id", id);
  revalidatePath(`/admin/subjects/${subjectId}`);
}

// Global "applicable for attempt" for the whole subject. Every topic inherits
// this window unless the topic sets its own override. normalizeWindow() drops a
// reversed "to" so an impossible window can never hide the subject.
export async function updateSubjectApplicability(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const { from, to } = normalizeWindow(
    str(formData.get("valid_from_attempt")) || null,
    str(formData.get("valid_to_attempt")) || null,
  );
  await createServiceClient().from("subjects").update({
    valid_from_attempt: from,
    valid_to_attempt: to,
  }).eq("id", id);
  revalidatePath(`/admin/subjects/${id}`);
}

// Save the admin's free-text remarks/notes for a subject.
export async function updateSubjectRemarks(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("subjects").update({ remarks: str(formData.get("remarks")) || null }).eq("id", id);
  revalidatePath(`/admin/subjects/${id}`);
}

// Subject-level "most important questions" for first & second revision.
export async function saveSubjectMIQ(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("subjects").update({
    miq_rev1: str(formData.get("miq_rev1")) || null,
    miq_rev2: str(formData.get("miq_rev2")) || null,
  }).eq("id", id);
  revalidatePath(`/admin/subjects/${id}`);
}

// Per-chapter weightage, entered once at subject level for every topic.
export async function saveSubjectWeightage(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: topics } = await svc.from("topics").select("id").eq("subject_id", id);
  for (const t of topics ?? []) {
    const v = num(formData.get(`w_${t.id}`));
    await svc.from("topics").update({ weightage_marks: v > 0 ? v : null }).eq("id", t.id);
  }
  revalidatePath(`/admin/subjects/${id}`);
}

// Upload a subject-level material (ICAI / MTP / RTP / past papers), attempt-tagged.
// ICAI is AI-only (copyright — never shown to students); the rest are shown.
export async function addSubjectMaterial(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  const kind = str(formData.get("kind")) || "rtp";
  const fileUrl = str(formData.get("file_url")) || null;
  if (!subjectId || !fileUrl) return;
  let content: string | null = null;
  if (/\.pdf($|\?)/i.test(fileUrl)) {
    const { extractPdfText } = await import("@/lib/pdf");
    content = (await extractPdfText(fileUrl)) || null;
  }
  await createServiceClient().from("repository_items").insert({
    title: str(formData.get("title")) || kind.toUpperCase(),
    kind,
    subject_id: subjectId,
    topic_id: null,
    file_url: fileUrl,
    content,
    is_active: true,
    student_visible: kind !== "icai", // ICAI copyright → AI only
    valid_from_attempt: str(formData.get("valid_from_attempt")) || null,
    valid_to_attempt: str(formData.get("valid_to_attempt")) || null,
  });
  revalidatePath(`/admin/subjects/${subjectId}`);
  redirect(`/admin/subjects/${subjectId}?added=material#subject-content`);
}

export async function deleteSubjectMaterial(formData: FormData) {
  const id = str(formData.get("id"));
  const subjectId = str(formData.get("parentId"));
  if (!id) return;
  await createServiceClient().from("repository_items").delete().eq("id", id);
  if (subjectId) revalidatePath(`/admin/subjects/${subjectId}`);
}

export async function updateSubjectInline(formData: FormData) {
  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  if (!id || !title) return;
  const goldStr = str(formData.get("gold_price_inr"));
  const validity = num(formData.get("validity_months"));
  const supabase = createClient();
  await supabase
    .from("subjects")
    .update({
      title,
      slug: str(formData.get("slug")) || slugify(title),
      code: str(formData.get("code")).toUpperCase().replace(/[^A-Z0-9]/g, "") || null,
      telegram_group_url: str(formData.get("telegram_group_url")) || null,
      order_index: num(formData.get("order_index")),
      gold_price_inr: goldStr ? Number(goldStr) : null,
      validity_months: validity > 0 ? validity : 12,
    })
    .eq("id", id);
  revalidatePath(`/admin/subjects/${id}`);
}

// Replace the subject's faculty set with whatever is checked.
export async function setSubjectFaculty(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  if (!subjectId) return;
  const facultyIds = formData.getAll("faculty_id").map((v) => String(v));
  const supabase = createClient();
  await supabase.from("subject_faculty").delete().eq("subject_id", subjectId);
  if (facultyIds.length) {
    await supabase
      .from("subject_faculty")
      .insert(facultyIds.map((faculty_id) => ({ subject_id: subjectId, faculty_id })));
  }
  revalidatePath(`/admin/subjects/${subjectId}`);
}
