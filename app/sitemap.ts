import type { MetadataRoute } from "next";

// The public pages we want Google to index, under the new domain.
export default function sitemap(): MetadataRoute.Sitemap {
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
    "/privacy",
    "/terms",
    "/refund",
  ];
  return paths.map((p) => ({
    url: `${base}${p}`,
    changeFrequency: "weekly",
    priority: p === "" ? 1 : 0.7,
  }));
}
