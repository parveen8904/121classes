"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractPdfText } from "@/lib/pdf";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  return requireArea("repository"); // admin always; operator/faculty with this right
}

const orNull = (v: FormDataEntryValue | null) => str(v).trim() || null;

// Kick off repository ingest in the BACKGROUND (transcripts → class summaries,
// PDFs → text, handwritten notes → text). Fires the self-chaining /api/repo-ingest
// route and returns immediately, so the whole backlog drains hands-free instead
// of timing out on a big synchronous run. Refresh the page to watch the count drop.
export async function runIngestNow() {
  if (!(await requireAdmin())) return;
  try {
    const { headers } = await import("next/headers");
    const { getSecret } = await import("@/lib/secrets");
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const secret = await getSecret("CRON_SECRET");
    if (host) {
      // 8s handoff window: the old 1.5s abort frequently killed the ingest
      // request before it even started — clicks looked like they did nothing.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      await fetch(`${proto}://${host}/api/repo-ingest${secret ? `?key=${encodeURIComponent(secret)}` : ""}`, { signal: ac.signal, cache: "no-store" }).catch(() => null);
      clearTimeout(timer);
    }
  } catch { /* background route + overnight cron continue the queue */ }
  revalidatePath("/admin/repository");
}

export async function addRepositoryItem(formData: FormData) {
  if (!(await requireAdmin())) return;
  const title = str(formData.get("title")).trim();
  if (!title) return;
  const fileUrl = orNull(formData.get("file_url"));
  let content = orNull(formData.get("content"));

  // Auto-extract text from an uploaded PDF when no text was pasted.
  if (!content && fileUrl && /\.pdf($|\?)/i.test(fileUrl)) {
    const extracted = await extractPdfText(fileUrl);
    if (extracted) content = extracted;
  }

  // Only a PDF can be shared on the public Resources page.
  const shareToResources = formData.get("share_to_resources") === "on" && !!fileUrl && /\.pdf($|\?)/i.test(fileUrl);

  const svc = createServiceClient();
  await svc.from("repository_items").insert({
    title,
    kind: str(formData.get("kind")) || "transcript",
    subject_id: orNull(formData.get("subject_id")),
    course_id: orNull(formData.get("course_id")),
    file_url: fileUrl,
    content,
    valid_from: orNull(formData.get("valid_from")),
    valid_to: orNull(formData.get("valid_to")),
    valid_from_attempt: orNull(formData.get("valid_from_attempt")),
    share_to_resources: shareToResources,
    resource_label: shareToResources ? (str(formData.get("resource_label")) || title) : null,
    // AI Repository uploads are AI-only by default — NOT shown to students
    // (this is where copyright material like ICAI study material lives). The
    // form can tick "share_to_resources" to expose a PDF publicly if wanted.
    student_visible: false,
  });
  revalidatePath("/admin/repository");
  revalidatePath("/resources");
}

// Re-extract text from an item's PDF (for file-only items, or to refresh).
export async function extractItemText(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: item } = await svc.from("repository_items").select("file_url").eq("id", id).maybeSingle();
  if (item?.file_url) {
    const text = await extractPdfText(item.file_url);
    if (text) await svc.from("repository_items").update({ content: text }).eq("id", id);
  }
  revalidatePath("/admin/repository");
}

export async function deleteRepositoryItem(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("repository_items").delete().eq("id", id);
  revalidatePath("/admin/repository");
}

export async function toggleRepositoryItem(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!id) return;
  await createServiceClient().from("repository_items").update({ is_active: active }).eq("id", id);
  revalidatePath("/admin/repository");
}

// REFRESH THE SEARCH INDEX.
//
// The AI does not read his books any more — it looks them up. Their text is cut
// into passages, indexed with full-text search, tagged with level, topic, kind
// and attempt, and every numbered question is recorded with where it starts and
// ends. That index is built from the material as it stood when it was last
// built, so material added since is INVISIBLE to the AI until this is pressed.
//
// Kept as a button rather than something automatic on upload because a rebuild
// walks every item; doing it once after a batch of uploads is right, doing it
// eleven times during the batch is waste. The page tells him when it is stale.
export async function refreshRepositoryIndex(): Promise<void> {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  await svc.rpc("rebuild_repository_index_full");
  revalidatePath("/admin/repository");
}

// READ THE SCANS.
//
// Thirteen past exam papers — every CA Final and CA Inter paper we hold — carry
// no text at all. They are photographs of pages, so the ordinary PDF reader
// found nothing and stamped them "__unreadable__", and they have been invisible
// to the AI ever since. A student asking about the May 2024 paper gets nothing,
// however good the index is.
//
// The same vision model that reads handwritten class notes can read them. It is
// slower and it costs, so this runs a few at a time and can be pressed again;
// each press picks up where the last left off.
export async function readUnreadableFiles(): Promise<void> {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const { data: stuck } = await svc
    .from("repository_items")
    .select("id, title, file_url")
    .eq("is_active", true)
    .not("file_url", "is", null)
    .or("content.eq.__unreadable__,content.is.null")
    .limit(4);

  const { transcribeHandwriting } = await import("@/lib/ai");
  for (const it of stuck ?? []) {
    const url = String((it as { file_url?: string }).file_url ?? "");
    if (!url) continue;
    // The plain text reader first — cheap, and some of these may simply have
    // failed once on a network blip rather than being true scans.
    let text = await extractPdfText(url).catch(() => "");
    if (!text || text.trim().length < 200) {
      text = (await transcribeHandwriting(url, { force: true }).catch(() => null)) ?? "";
    }
    if (text && text.trim().length > 200) {
      await svc.from("repository_items").update({ content: text }).eq("id", (it as { id: string }).id);
    }
  }
  revalidatePath("/admin/repository");
}
