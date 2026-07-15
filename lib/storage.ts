import { createServiceClient } from "@/lib/supabase/service";

// Private storage for sensitive files (student answer sheets, and later paid
// course PDFs). Files live in the non-public `secure` bucket and are referenced
// in the DB as "secure:<path>" so they can never be fetched by a raw URL — only
// through a short-lived signed URL minted server-side by the service role.

export const SECURE_BUCKET = "secure";
const PREFIX = "secure:";

export function isSecureRef(ref?: string | null): boolean {
  return !!ref && ref.startsWith(PREFIX);
}
export function secureRef(path: string): string {
  return PREFIX + path;
}

// Turn a stored reference into a fetchable https URL. A "secure:<path>" ref
// becomes a short-lived signed URL; any other value (legacy public URL, an
// external link, or "") is returned unchanged — so old files keep working.
export async function resolveFileUrl(ref: string | null | undefined, ttlSeconds = 300): Promise<string> {
  if (!ref) return "";
  if (!ref.startsWith(PREFIX)) return ref;
  const path = ref.slice(PREFIX.length);
  const { data } = await createServiceClient().storage.from(SECURE_BUCKET).createSignedUrl(path, ttlSeconds);
  return data?.signedUrl ?? "";
}
