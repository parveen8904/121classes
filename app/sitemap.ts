import type { MetadataRoute } from "next";
import { tryServiceClient } from "@/lib/supabase/service";

// Everything we want Google to index. Anything that redirects a logged-out
// visitor to /login is deliberately left out — a search result that lands on a
// login screen is worse than no search result at all. The list below was
// checked against the live site: every one returns 200 to a stranger.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://caparveensharma.com";

  // Priority is a hint about which pages matter most when Google decides what
  // to crawl and how to weigh these against each other.
  const pages: [string, number][] = [
    ["", 1],
    ["/courses", 0.9],
    ["/pricing", 0.9],          // was missing
    ["/free-planner", 0.9],
    ["/articles", 0.8],
    ["/notes", 0.85],           // free PDF downloads — a page each, on our domain
    ["/test-series", 0.8],
    ["/books", 0.7],
    ["/combos", 0.7],           // was missing
    ["/results", 0.7],
    ["/faculty", 0.7],
    ["/build-your-plan", 0.7],
    ["/placements", 0.6],
    ["/guide", 0.6],            // was missing
    ["/help", 0.6],             // was missing
    ["/sponsor-guide", 0.5],    // was missing
    ["/startups", 0.5],         // was missing
    ["/calendar", 0.5],         // was missing
    ["/download", 0.5],
    ["/install", 0.5],
    ["/support", 0.4],
    ["/privacy", 0.3],
    ["/terms", 0.3],
    ["/refund", 0.3],
  ];

  const out: MetadataRoute.Sitemap = pages.map(([p, priority]) => ({
    // The homepage as "https://…/" rather than a bare host — some validators
    // treat a URL with no path at all as suspect.
    url: p === "" ? `${base}/` : `${base}${p}`,
    changeFrequency: "weekly",
    priority,
  }));

  const svc = tryServiceClient();
  if (!svc) return out;

  // Every published article — the SEO engine's output, and the bulk of what
  // brings students in from Google.
  const { data: articles } = await svc
    .from("articles")
    .select("slug, updated_at")
    .eq("is_published", true)
    .limit(2000);
  for (const a of articles ?? []) {
    out.push({
      url: `${base}/articles/${a.slug}`,
      // Plain YYYY-MM-DD. The default carries milliseconds
      // ("2026-07-16T05:31:54.926Z"), which is legal but is the kind of thing
      // strict validators complain about — and it says nothing useful.
      lastModified: a.updated_at ? String(a.updated_at).slice(0, 10) : undefined,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  // One entry per subject. "CA Final Financial Reporting" is exactly what a
  // student types into Google, and each subject already has a public page.
  const { data: subjects } = await svc.from("subjects").select("id").limit(200);
  for (const s of subjects ?? []) {
    out.push({ url: `${base}/courses/${s.id}`, changeFrequency: "weekly", priority: 0.8 });
  }

  // Every free PDF that has been given a page of its own. These exist so the
  // ranking lands on caparveensharma.com rather than on the storage domain.
  const { data: notes } = await svc
    .from("repository_items")
    .select("share_slug")
    .eq("public_sample", true)
    .eq("is_active", true)
    .not("share_slug", "is", null)
    .limit(1000);
  for (const n of notes ?? []) {
    out.push({ url: `${base}/notes/${n.share_slug}`, changeFrequency: "monthly", priority: 0.7 });
  }

  const { data: books } = await svc.from("books").select("id").limit(200);
  for (const b of books ?? []) {
    out.push({ url: `${base}/books/${b.id}`, changeFrequency: "monthly", priority: 0.5 });
  }

  return out;
}
