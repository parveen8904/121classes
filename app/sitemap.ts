import type { MetadataRoute } from "next";
import { tryServiceClient } from "@/lib/supabase/service";

// The public pages we want Google to index, under the new domain.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://caparveensharma.com";
  const paths = [
    "",
    "/courses",
    "/build-your-plan",
    "/results",
    "/placements",
    "/books",
    "/test-series",
    "/download",
    "/install",
    "/faculty",
    "/free-planner",
    "/articles",
    "/support",
    "/privacy",
    "/terms",
    "/refund",
  ];
  const fixed: MetadataRoute.Sitemap = paths.map((p) => ({
    url: `${base}${p}`,
    changeFrequency: "weekly",
    priority: p === "" ? 1 : 0.7,
  }));

  // Every published article (the SEO engine's output).
  const svc = tryServiceClient();
  if (svc) {
    const { data } = await svc
      .from("articles")
      .select("slug, updated_at")
      .eq("is_published", true)
      .limit(1000);
    for (const a of data ?? []) {
      fixed.push({
        url: `${base}/articles/${a.slug}`,
        lastModified: a.updated_at ? new Date(a.updated_at as string) : undefined,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }
  return fixed;
}
