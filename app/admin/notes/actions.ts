"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { assertArea } from "@/lib/adminAccess";
import { str } from "../_lib/util";

// The free-download pages are only as good as their titles: "MAY 2025" tells
// Google nothing, while "CA Final Financial Reporting — May 2025 question
// paper" is what a student actually types. So the title, the address and the
// one-line summary are all editable here.

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
}

export async function shareItem(formData: FormData) {
  await assertArea("repository");
  const id = str(formData.get("id"));
  const on = formData.get("on") === "1";
  if (!id) return;
  const svc = createServiceClient();
  if (!on) {
    await svc.from("repository_items").update({ public_sample: false }).eq("id", id);
    revalidatePath("/admin/notes");
    return;
  }
  const { data: it } = await svc.from("repository_items").select("title, share_slug").eq("id", id).maybeSingle();
  const slug = (it?.share_slug as string) || `${slugify(String(it?.title ?? "download"))}-${id.slice(0, 6)}`;
  await svc.from("repository_items").update({ public_sample: true, share_slug: slug }).eq("id", id);
  revalidatePath("/admin/notes");
  revalidatePath("/notes");
}

export async function saveItemSeo(formData: FormData) {
  await assertArea("repository");
  const id = str(formData.get("id"));
  const title = str(formData.get("title")).trim();
  const summary = str(formData.get("summary")).trim();
  const slugRaw = str(formData.get("slug")).trim();
  if (!id || !title) return;
  const slug = slugify(slugRaw || title) || `download-${id.slice(0, 6)}`;
  const svc = createServiceClient();
  // A slug already used by another item would break its page, so fall back to
  // a unique one rather than failing silently.
  const { data: clash } = await svc
    .from("repository_items").select("id").eq("share_slug", slug).neq("id", id).maybeSingle();
  await svc.from("repository_items").update({
    title,
    share_summary: summary || null,
    share_slug: clash ? `${slug}-${id.slice(0, 6)}` : slug,
  }).eq("id", id);
  revalidatePath("/admin/notes");
  revalidatePath("/notes");
}
