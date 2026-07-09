/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
