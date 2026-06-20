"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify, str, num, nullable } from "../../_lib/util";

export async function createTopic(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  const title = str(formData.get("title"));
  if (!subjectId || !title) return;
  const supabase = createClient();
  await supabase.from("topics").insert({
    subject_id: subjectId,
    title,
    slug: str(formData.get("slug")) || slugify(title),
    order_index: num(formData.get("order_index")),
    // Applies from this attempt onward; end is always open (infinite).
    valid_from_attempt: nullable(formData.get("valid_from_attempt")),
    valid_to_attempt: null,
    amendments_upto: null,
    is_published: formData.get("is_published") === "on",
  });
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
