import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { writeArticle } from "@/lib/ai";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Works through the article_topics queue: writes up to BATCH articles per
// invocation, then re-triggers itself until the queue is empty — so seeding 50
// topics turns into 50 published articles hands-free. Also on the hourly cron
// as a safety net.
const BATCH = 3;

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data: pending } = await svc
    .from("article_topics")
    .select("id, topic, category, keywords")
    .eq("status", "pending")
    .order("created_at")
    .limit(BATCH);
  if (!pending?.length) return NextResponse.json({ ok: true, done: true, written: 0 });

  let written = 0;
  for (const t of pending) {
    const art = await writeArticle(t.topic as string, (t.keywords as string) || "");
    if (!art) {
      // AI off/unconfigured or unparseable output — leave pending for the next
      // hourly pass rather than marking failed (transient outages self-heal).
      continue;
    }
    let slug = slugify(art.title) || slugify(t.topic as string) || `article-${Date.now()}`;
    const { data: clash } = await svc.from("articles").select("id").eq("slug", slug).maybeSingle();
    if (clash) slug = `${slug}-${String(Date.now()).slice(-5)}`;
    const { data: ins } = await svc.from("articles").insert({
      slug,
      title: art.title,
      description: art.description || null,
      body_md: art.body_md,
      category: (t.category as string) || null,
      keywords: (t.keywords as string) || null,
      is_published: true,
    }).select("id").maybeSingle();
    if (ins) {
      await svc.from("article_topics").update({ status: "done", article_id: ins.id }).eq("id", t.id);
      written++;
    }
  }

  if (written > 0) {
    revalidatePath("/articles");
    revalidatePath("/sitemap.xml");
  }

  // More in the queue and this batch made progress → chain the next batch.
  const { count: left } = await svc.from("article_topics").select("id", { count: "exact", head: true }).eq("status", "pending");
  if (written > 0 && (left ?? 0) > 0) {
    try {
      const url = new URL(req.url);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 1500);
      await fetch(`${url.origin}/api/articles-generate${secret ? `?key=${encodeURIComponent(secret)}` : ""}`, { signal: ac.signal, cache: "no-store" }).catch(() => null);
      clearTimeout(timer);
    } catch { /* hourly cron continues the queue */ }
  }

  return NextResponse.json({ ok: true, written, remaining: left ?? 0 });
}
