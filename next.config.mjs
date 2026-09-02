/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel's image optimizer may resize/convert our Supabase Storage images
  // (uploaded photos are multi-MB PNGs; optimized AVIF/WebP is ~30-100 KB).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "xmeltwyfvzhhurtcjfiu.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
    formats: ["image/avif", "image/webp"],
    qualities: [60, 75],
    minimumCacheTTL: 86400,
  },
  // Allow bigger server-action payloads so students can attach an image/PDF to
  // a doubt (photographed question). Downscaled client-side; 8mb is plenty.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  // A NATIVE MODULE CANNOT BE BUNDLED.
  //
  // @napi-rs/canvas is a prebuilt binary, and it is what lets pdf.js DRAW a
  // page — the only way to read a statement that carries neither text nor
  // pictures, because its type has been converted to outlines. The bundler
  // tries to follow its .node binding and fails; left external, it is required
  // at runtime as it expects to be.
  serverExternalPackages: ["@napi-rs/canvas"],
  // Public images are served from OUR domain, not the storage host.
  //
  // Every uploaded photo went out as
  //   /_next/image?url=https://<project>.supabase.co/storage/v1/object/public/...
  // so the database project was named in the page source of the home page, the
  // faculty page and every results photo. This rewrite puts the same file on
  // caparveensharma.com/media/..., which is what the pages now link to.
  //
  // ONLY the folders that are meant to be public are exposed: site, books and
  // results. Class materials and repository papers are NOT reachable this way —
  // they belong in the private bucket and are served through /api/file after a
  // login check.
  // ONE ADDRESS FOR THE SITE, NOT TWO.
  //
  // www.caparveensharma.com was answering 200 in its own right, so Google had a
  // second copy of every page. It reported them as "Alternate page with proper
  // canonical tag" — our canonical was saving us, but only after Google had
  // spent a crawl on each www page and then thrown it away. The www host now
  // says permanently, in one hop, that the site lives on the bare domain.
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "www.caparveensharma.com" }],
      destination: "https://caparveensharma.com/:path*",
      permanent: true,
    }];
  },

  async rewrites() {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
    if (!base) return [];
    return ["site", "books", "results"].map((folder) => ({
      source: `/media/${folder}/:path*`,
      destination: `${base}/storage/v1/object/public/media/${folder}/:path*`,
    }));
  },

  // Browser-level armor on every response. NOTE: no X-Frame-Options DENY —
  // the site runs inside the iOS/Android/desktop app webviews (same-origin
  // navigation, not framing, so DENY would be safe — but SAMEORIGIN also keeps
  // the admin previews working). Clickjacking is blocked for foreign sites.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      // A JAVASCRIPT CHUNK IS NOT A PAGE — SAY SO, DO NOT HIDE IT.
      //
      // Search Console listed 195 URLs as "Crawled - currently not indexed" and
      // 190 of them were /_next/static/chunks/*.js and *.css: the site's own
      // build files. They can never be indexed and they were burning crawl
      // budget that should be going to the courses and the articles.
      //
      // The tempting fix — Disallow: /_next/ in robots.txt — would be a serious
      // mistake. Google renders the site to see it, and rendering needs exactly
      // these files; blocking them makes every page look broken to the crawler.
      // So they stay fully crawlable and carry a header saying they are not to
      // be indexed. That is the difference between "do not look at this" and
      // "look, but this is not a page".
      {
        source: "/_next/static/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      {
        source: "/_next/image",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      // The API answers machines, not searchers.
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

export default nextConfig;
