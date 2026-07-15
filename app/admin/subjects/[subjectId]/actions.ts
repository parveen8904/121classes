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
  // A custom item can carry a PDF OR a video link (either satisfies the form).
  const fileUrl = str(formData.get("file_url")) || str(formData.get("video_url")) || null;
  if (!subjectId || !fileUrl) return;
  let content: string | null = null;
  if (/\.pdf($|\?)/i.test(fileUrl)) {
    const { extractPdfText } = await import("@/lib/pdf");
    content = (await extractPdfText(fileUrl)) || null;
  }
  const aiOnly = str(formData.get("ai_only")) === "on";
  await createServiceClient().from("repository_items").insert({
    title: str(formData.get("title")) || kind.toUpperCase(),
    kind,
    subject_id: subjectId,
    topic_id: null,
    file_url: fileUrl,
    // Suggested-answers PDF for MTP/RTP/past papers → enables student AI evaluation.
    solution_url: str(formData.get("solution_url")) || null,
    content,
    is_active: true,
    student_visible: kind !== "icai" && !aiOnly, // ICAI copyright → AI only
    valid_from_attempt: str(formData.get("valid_from_attempt")) || null,
    valid_to_attempt: str(formData.get("valid_to_attempt")) || null,
  });
  revalidatePath(`/admin/subjects/${subjectId}`);
  redirect(`/admin/subjects/${subjectId}?added=material#subject-content`);
}

// ---- Case-study sets (PDF → parsed cases + MCQs) ----
// Fire the background parser and abandon the connection: the route keeps
// running (and self-chains) after we abort, so a 150-page PDF parses hands-free.
async function triggerCaseParse() {
  const { headers } = await import("next/headers");
  const { getSecret } = await import("@/lib/secrets");
  const host = headers().get("host");
  const proto = headers().get("x-forwarded-proto") || "https";
  const secret = await getSecret("CRON_SECRET");
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    await fetch(`${proto}://${host}/api/case-parse${secret ? `?key=${encodeURIComponent(secret)}` : ""}`, { signal: ac.signal, cache: "no-store" }).catch(() => null);
    clearTimeout(t);
  } catch { /* hourly cron continues it anyway */ }
}

export async function createCaseSet(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  const fileUrl = str(formData.get("file_url"));
  if (!subjectId || !fileUrl) return;
  const { extractPdfText } = await import("@/lib/pdf");
  const text = await extractPdfText(fileUrl);
  const svc = createServiceClient();
  if (!text || text.length < 500) {
    await svc.from("case_sets").insert({
      subject_id: subjectId,
      title: str(formData.get("title")) || "Case studies",
      file_url: fileUrl,
      source_text: text || null,
      status: "failed",
      status_note: "Could not read text from this PDF (is it scanned images?). Try a text-based PDF.",
    });
  } else {
    await svc.from("case_sets").insert({
      subject_id: subjectId,
      title: str(formData.get("title")) || "Case studies",
      file_url: fileUrl,
      source_text: text,
      status: "processing",
      status_note: "parsing started",
    });
    await triggerCaseParse();
  }
  revalidatePath(`/admin/subjects/${subjectId}`);
  redirect(`/admin/subjects/${subjectId}?added=caseset#case-sets`);
}

export async function continueCaseParse(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  await triggerCaseParse();
  if (subjectId) revalidatePath(`/admin/subjects/${subjectId}`);
}

export async function toggleCaseSetPublish(formData: FormData) {
  const id = str(formData.get("id"));
  const subjectId = str(formData.get("subjectId"));
  if (!id) return;
  await createServiceClient().from("case_sets").update({ is_published: formData.get("next") === "true" }).eq("id", id);
  if (subjectId) revalidatePath(`/admin/subjects/${subjectId}`);
}

export async function deleteCaseSet(formData: FormData) {
  const id = str(formData.get("id"));
  const subjectId = str(formData.get("parentId"));
  if (!id) return;
  await createServiceClient().from("case_sets").delete().eq("id", id);
  if (subjectId) revalidatePath(`/admin/subjects/${subjectId}`);
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
