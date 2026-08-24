import type { MetadataRoute } from "next";

// Tells search engines what to crawl, and where the sitemap is.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // BLOCKING A PAGE DOES NOT REMOVE IT FROM GOOGLE — IT ONLY BLINDS GOOGLE.
      //
      // /login was disallowed here, and Search Console still had /planner and
      // /login in the index, listed as "Indexed, though blocked by robots.txt":
      // they appear in results with no description, because Google knew the
      // addresses from links but was forbidden to fetch them and read the
      // noindex that would have dropped them. /scholarship, /career and
      // /planner all redirect to /login, so they inherited the same fate.
      //
      // /login is therefore crawlable now and carries a noindex of its own,
      // which is the only instruction that actually removes a page. The rest of
      // this list is different in kind: those are areas nobody outside should be
      // fetching at all, and none of them is in the index.
      disallow: ["/admin", "/dashboard", "/learn", "/inbox", "/api", "/auth"],
    },
    sitemap: "https://caparveensharma.com/sitemap.xml",
    host: "https://caparveensharma.com",
  };
}
