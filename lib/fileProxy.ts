// Wrap a raw storage URL so it's served via our domain (see /api/file).
export function viaProxy(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/")) return url; // already ours
  return `/api/file?u=${encodeURIComponent(url)}`;
}
