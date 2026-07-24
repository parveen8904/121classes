import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { writeArticle } from "@/lib/ai";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Works through the article_topics queue: writes up to BATCH articles per
// invocation. When the queue runs DRY it refills itself with fresh evergreen
// topics (the queue emptied on 20 Jul and articles silently stopped for days),
// and a daily cap keeps output a steady SEO drip instead of a burst.
const BATCH = 3;
const DAILY_CAP = 6; // articles per rolling 24h — steady beats bursty for SEO

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

  // Steady drip: never more than DAILY_CAP articles in a rolling 24 hours.
  const { count: last24h } = await svc
    .from("articles").select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if ((last24h ?? 0) >= DAILY_CAP) return NextResponse.json({ ok: true, capped: true, written: 0 });
  const budget = Math.min(BATCH, DAILY_CAP - (last24h ?? 0));

  let { data: pending } = await svc
    .from("article_topics")
    .select("id, topic, category, keywords")
    .eq("status", "pending")
    .order("created_at")
    .limit(budget);

  // Queue dry → REFILL with evergreen topics, then continue writing.
  if (!pending?.length) {
    const { data: existingT } = await svc
      .from("article_topics").select("topic").order("created_at", { ascending: false }).limit(250);
    const { proposeEvergreenTopics } = await import("@/lib/ai");
    const ideas = await proposeEvergreenTopics((existingT ?? []).map((r) => r.topic as string));
    if (ideas?.length) {
      await svc.from("article_topics").insert(ideas.map((i) => ({ topic: i.topic, category: i.category, keywords: i.keywords, status: "pending" })));
      ({ data: pending } = await svc
        .from("article_topics").select("id, topic, category, keywords")
        .eq("status", "pending").order("created_at").limit(budget));
    }
  }
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

  // More in the queue, progress made, AND still under the daily cap → chain.
  const { count: left } = await svc.from("article_topics").select("id", { count: "exact", head: true }).eq("status", "pending");
  if (written > 0 && (left ?? 0) > 0 && (last24h ?? 0) + written < DAILY_CAP) {
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
