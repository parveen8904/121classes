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
    minimumCacheTTL: 86400,
  },
  // Allow bigger server-action payloads so students can attach an image/PDF to
  // a doubt (photographed question). Downscaled client-side; 8mb is plenty.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
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
    ];
  },
};

export default nextConfig;
