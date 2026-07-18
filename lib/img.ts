// Serve heavy uploaded images through Vercel's image optimizer. Uploaded site
// photos are raw multi-MB PNGs in Supabase Storage; the optimizer resizes and
// converts them to AVIF/WebP (~30-100 KB) and caches them on the CDN. Use for
// every <img> whose src can be a Storage upload.
//
// w must be one of Next's default device sizes (640/750/828/1080/1200/1920…)
// — arbitrary widths 404.

const STORAGE_PREFIX = "https://xmeltwyfvzhhurtcjfiu.supabase.co/storage/v1/object/public/";

export function lightImg(url: string | null | undefined, w: 64 | 96 | 128 | 256 | 384 | 640 | 750 | 828 | 1080 | 1200 | 1920 = 828, q = 70): string {
  const u = (url ?? "").trim();
  if (!u.startsWith(STORAGE_PREFIX)) return u; // local /public assets or external — leave as is
  return `/_next/image?url=${encodeURIComponent(u)}&w=${w}&q=${q}`;
}
