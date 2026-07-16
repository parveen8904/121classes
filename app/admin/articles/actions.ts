"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { str } from "../_lib/util";

function refresh(slug?: string) {
  revalidatePath("/admin/articles");
  revalidatePath("/articles");
  if (slug) revalidatePath(`/articles/${slug}`);
  revalidatePath("/sitemap.xml");
}

export async function editArticle(formData: FormData) {
  if (!(await requireArea("articles"))) return;
  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  const body = str(formData.get("body_md"));
  if (!id || !title || !body) return;
  const svc = createServiceClient();
  const { data: cur } = await svc.from("articles").select("slug").eq("id", id).maybeSingle();
  await svc.from("articles").update({
    title,
    description: str(formData.get("description")) || null,
    body_md: body,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  refresh(cur?.slug as string | undefined);
}

export async function toggleArticle(formData: FormData) {
  if (!(await requireArea("articles"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: cur } = await svc.from("articles").select("slug, is_published").eq("id", id).maybeSingle();
  if (!cur) return;
  await svc.from("articles").update({ is_published: !cur.is_published }).eq("id", id);
  refresh(cur.slug as string);
}

export async function deleteArticle(formData: FormData) {
  if (!(await requireArea("articles"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  const { data: cur } = await svc.from("articles").select("slug").eq("id", id).maybeSingle();
  await svc.from("articles").delete().eq("id", id);
  refresh(cur?.slug as string | undefined);
}

export async function deleteTopic(formData: FormData) {
  if (!(await requireArea("articles"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("article_topics").delete().eq("id", id).eq("status", "pending");
  revalidatePath("/admin/articles");
}

// Add new topics to the queue (one per line) — the generator writes them.
export async function addTopics(formData: FormData) {
  if (!(await requireArea("articles"))) return;
  const lines = str(formData.get("topics")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 8);
  if (!lines.length) return;
  const category = str(formData.get("category")) || "strategy";
  await createServiceClient().from("article_topics").insert(lines.slice(0, 30).map((topic) => ({ topic, category, keywords: null })));
  revalidatePath("/admin/articles");
}

// Kick the generator now (same fire-and-forget pattern as the case parser —
// the route keeps running and self-chains after we abort).
export async function generateNow() {
  if (!(await requireArea("articles"))) return;
  const { headers } = await import("next/headers");
  const { getSecret } = await import("@/lib/secrets");
  const host = headers().get("host");
  const proto = headers().get("x-forwarded-proto") || "https";
  const secret = await getSecret("CRON_SECRET");
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    await fetch(`${proto}://${host}/api/articles-generate${secret ? `?key=${encodeURIComponent(secret)}` : ""}`, { signal: ac.signal, cache: "no-store" }).catch(() => null);
    clearTimeout(t);
  } catch { /* hourly cron picks the queue up anyway */ }
  revalidatePath("/admin/articles");
}
