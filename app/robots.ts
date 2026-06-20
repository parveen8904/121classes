import type { MetadataRoute } from "next";

// Tells search engines what to crawl, and where the sitemap is.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep private/app areas out of search results.
      disallow: ["/admin", "/dashboard", "/learn", "/inbox", "/api", "/auth", "/login"],
    },
    sitemap: "https://caparveensharma.com/sitemap.xml",
    host: "https://caparveensharma.com",
  };
}
