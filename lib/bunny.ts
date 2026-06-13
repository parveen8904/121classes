import crypto from "crypto";

// Build a Bunny Stream embed URL. SERVER-ONLY (signs with the secret token key).
// If BUNNY_STREAM_TOKEN_KEY is set, produces a signed URL that works with Bunny
// "Token Authentication" ON (secure). If not set, returns the plain embed
// (works only when token auth is OFF in the library).
const LIBRARY_ID = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID || "682810";

export function bunnyEmbedUrl(videoId: string): string {
  const base = `https://iframe.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}`;
  const params = "preload=false&responsive=true";
  const key = process.env.BUNNY_STREAM_TOKEN_KEY;
  if (!key) return `${base}?${params}`;
  const expires = Math.floor(Date.now() / 1000) + 6 * 3600; // 6 hours
  const token = crypto.createHash("sha256").update(key + videoId + expires).digest("hex");
  return `${base}?token=${token}&expires=${expires}&${params}`;
}
