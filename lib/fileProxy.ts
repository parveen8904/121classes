// Wrap a raw storage URL so it's served via our domain (see /api/file).
//
// The link must not carry the storage address. Passing the whole URL through
// as ?u= put it in the address bar of every student who opened a checked copy:
//
//   caparveensharma.com/api/file?u=https://<project>.supabase.co/storage/v1/
//     object/public/media/...
//
// which shows the database project by name AND hands out a public URL that
// opens with no login at all — so a paid PDF could be copied out of the address
// bar and passed round. A file stored in the public bucket is now referenced by
// its bucket and path alone; /api/file knows where storage lives and the
// student never sees it.
const PUBLIC_OBJECT = /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/;

export function viaProxy(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/")) return url; // already ours

  // secure:<path> — already opaque, nothing to hide.
  if (url.startsWith("secure:")) return `/api/file?u=${encodeURIComponent(url)}`;

  const m = url.split("?")[0].match(PUBLIC_OBJECT);
  if (m) return `/api/file?b=${encodeURIComponent(m[1])}&p=${encodeURIComponent(m[2])}`;

  return `/api/file?u=${encodeURIComponent(url)}`;
}
