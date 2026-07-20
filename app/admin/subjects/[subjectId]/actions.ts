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
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
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

// Edit / update / replace an already-uploaded material. Empty file fields keep
// the existing file (so you can, e.g., add a suggested-answers PDF to a past
// paper months later without re-uploading the question paper).
export async function editSubjectMaterial(formData: FormData) {
  const id = str(formData.get("id"));
  const subjectId = str(formData.get("subjectId"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: existing } = await svc
    .from("repository_items")
    .select("kind, file_url, content")
    .eq("id", id)
    .maybeSingle();

  const update: Record<string, unknown> = {};

  const title = str(formData.get("title"));
  if (title) update.title = title;

  // Attempt tags — a submitted value overwrites; blank keeps the current one.
  for (const f of ["valid_from_attempt", "valid_to_attempt"] as const) {
    const v = str(formData.get(f));
    if (v) update[f] = v;
  }

  // Replace the main file (question paper / PDF / video). Blank = keep current.
  const newFile = str(formData.get("file_url")) || str(formData.get("video_url"));
  if (newFile && newFile !== existing?.file_url) {
    update.file_url = newFile;
    if (/\.pdf($|\?)/i.test(newFile)) {
      const { extractPdfText } = await import("@/lib/pdf");
      update.content = (await extractPdfText(newFile)) || null;
    }
  }

  // Add / replace the suggested-answers PDF (turns on AI evaluation). Blank = keep.
  const newSolution = str(formData.get("solution_url"));
  if (newSolution) update.solution_url = newSolution;

  // Optional visibility toggle for AI-only items.
  const aiOnly = formData.get("ai_only");
  if (aiOnly !== null && existing?.kind && existing.kind !== "icai") {
    update.student_visible = str(aiOnly) !== "on";
  }

  // Free-sample flag (lead magnet on the public try page). ICAI is copyright —
  // its edit form has no such checkbox and it can never be a public sample.
  if (existing?.kind && existing.kind !== "icai") {
    update.public_sample = formData.get("public_sample") === "on";
  }

  if (Object.keys(update).length > 0) {
    await svc.from("repository_items").update(update).eq("id", id);
  }
  if (subjectId) revalidatePath(`/admin/subjects/${subjectId}`);
  redirect(`/admin/subjects/${subjectId}?edited=material#subject-content`);
}

// Parse a "3:600, 6:500, 12:400, 24:300" ladder into slab JSON (or null).
// Rates may carry paise (e.g. "12:287.50"); month caps stay whole numbers.
function parseSlabInput(raw: string): { upto: number; rate: number }[] | null {
  const slabs = raw
    .split(/[,\n]/)
    .map((p) => {
      const [u, r] = p.split(":");
      return [parseInt((u ?? "").trim(), 10), parseFloat((r ?? "").trim())] as const;
    })
    .filter(([upto, rate]) => Number.isFinite(upto) && upto > 0 && Number.isFinite(rate) && rate >= 0)
    .map(([upto, rate]) => ({ upto, rate: Math.round(rate * 100) / 100 }))
    .sort((a, b) => a.upto - b.upto);
  return slabs.length ? slabs : null;
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
      // Slab ladders ("months:₹/mo, …"); blank clears → falls back to flat pricing.
      gold_slabs: parseSlabInput(str(formData.get("gold_slabs"))),
      silver_slabs: parseSlabInput(str(formData.get("silver_slabs"))),
      // Live batch: fixed months + one fixed GST-inclusive price; blank = normal subject.
      batch_months: num(formData.get("batch_months")) || null,
      batch_price_inr: num(formData.get("batch_price_inr")) || null,
      included_with_subject_id: str(formData.get("included_with_subject_id")) || null,
      intro_video_url: str(formData.get("intro_video_url")) || null,
    })
    .eq("id", id);

  // Live batch: which old chapter this batch re-teaches (stored on the batch's
  // first topic as supersedes_topic_id). Field only exists on bundled batches.
  const reteach = formData.get("reteaches_topic_id");
  if (reteach !== null) {
    const svc = createServiceClient();
    const { data: ft } = await svc.from("topics").select("id").eq("subject_id", id).order("order_index").limit(1).maybeSingle();
    if (ft) await svc.from("topics").update({ supersedes_topic_id: str(reteach) || null }).eq("id", ft.id);
  }

  revalidatePath(`/admin/subjects/${id}`);
}

// Copy another topic's resources into this subject's first topic — used when a
// live batch re-teaches an existing chapter and the UNCHANGED materials (book,
// ICAI, question bank, papers, amendments) should carry over without
// re-uploading. Files aren't duplicated in storage — only the catalog rows.
export async function copyTopicResources(formData: FormData) {
  const subjectId = str(formData.get("subjectId"));
  const fromTopicId = str(formData.get("from_topic_id"));
  if (!subjectId || !fromTopicId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null };
  if (me?.role !== "admin") return;

  const svc = createServiceClient();
  const { data: toTopic } = await svc.from("topics").select("id").eq("subject_id", subjectId).order("order_index").limit(1).maybeSingle();
  if (!toTopic) return;

  // 1) Topic-level materials (books / ICAI / question banks / papers / notes).
  const { data: items } = await svc
    .from("repository_items")
    .select("title, kind, course_id, file_url, content, valid_from, valid_to, valid_from_attempt, valid_to_attempt, is_active, share_to_resources, resource_label, student_visible, solution_url, public_sample")
    .eq("topic_id", fromTopicId)
    .eq("is_active", true);
  const already = await svc.from("repository_items").select("title").eq("topic_id", toTopic.id);
  const have = new Set((already.data ?? []).map((r) => r.title as string));
  const copies = (items ?? [])
    .filter((r) => !have.has(r.title as string))
    .map((r) => ({ ...r, subject_id: subjectId, topic_id: toTopic.id }));
  if (copies.length) await svc.from("repository_items").insert(copies);

  // 2) Topic resource URL fields — fill only the ones still empty on the target.
  const FIELDS = ["book_pdf_url", "icai_material_url", "revision_video_url", "revision_notes_hand_url", "revision_notes_typed_url", "revision_paper_url", "amendments_pdf_url", "amendments_upto", "weightage_marks"] as const;
  const { data: src } = await svc.from("topics").select(FIELDS.join(", ")).eq("id", fromTopicId).maybeSingle();
  const { data: dst } = await svc.from("topics").select(FIELDS.join(", ")).eq("id", toTopic.id).maybeSingle();
  if (src && dst) {
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const s = (src as unknown as Record<string, unknown>)[f];
      const d = (dst as unknown as Record<string, unknown>)[f];
      if (s != null && s !== "" && (d == null || d === "")) patch[f] = s;
    }
    if (Object.keys(patch).length) await svc.from("topics").update(patch).eq("id", toTopic.id);
  }

  revalidatePath(`/admin/subjects/${subjectId}`);
  redirect(`/admin/subjects/${subjectId}?edited=resources-copied`);
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
