// Serve heavy uploaded images through Vercel's image optimizer. Uploaded site
// photos are raw multi-MB PNGs in Supabase Storage; the optimizer resizes and
// converts them to AVIF/WebP (~30-100 KB) and caches them on the CDN. Use for
// every <img> whose src can be a Storage upload.
//
// w must be one of Next's default device sizes (640/750/828/1080/1200/1920…)
// — arbitrary widths 404.
//
// The image is addressed on OUR domain. It used to go out as
//   /_next/image?url=https://<project>.supabase.co/storage/v1/object/public/...
// which put the database project into the page source of the home page, the
// faculty page and every results photo — readable by anyone who viewed source.
// next.config rewrites /media/<site|books|results>/… to storage, so the same
// file is fetched with nothing about the project in the link.

const PUBLIC_OBJECT = /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public\/)?media\/(.+)$/;

// The folders that are genuinely public and have a rewrite. Anything else —
// materials, repository, cases — is paid content and must never be addressed
// this way; it is served through /api/file, which checks for a login first.
const PUBLIC_FOLDERS = /^(site|books|results)\//;

/** A storage URL as it should appear on our own domain, or "" if it is not one. */
export function onOurDomain(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  const m = u.split("?")[0].match(PUBLIC_OBJECT);
  if (!m) return "";
  const path = decodeURIComponent(m[1]);
  if (!PUBLIC_FOLDERS.test(path)) return "";
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// q must be listed in next.config images.qualities (Next 16 rejects others).
export function lightImg(url: string | null | undefined, w: 64 | 96 | 128 | 256 | 384 | 640 | 750 | 828 | 1080 | 1200 | 1920 = 828, q: 60 | 75 = 75): string {
  const u = (url ?? "").trim();
  const ours = onOurDomain(u);
  if (!ours) return u; // local /public assets, or external — leave as is
  return `/_next/image?url=${encodeURIComponent(ours)}&w=${w}&q=${q}`;
}
