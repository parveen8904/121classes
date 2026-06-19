import crypto from "crypto";
import { getSecret } from "@/lib/secrets";

// Live Bunny billing — this month's charges + account balance. Needs the
// ACCOUNT API key (dash.bunny.net → Account → API), not the Stream library key.
export async function getBunnyBilling(): Promise<{ thisMonth: number; balance: number } | null> {
  const key = await getSecret("BUNNY_ACCOUNT_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.bunny.net/billing", {
      headers: { AccessKey: key, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { thisMonth: Number(d.ThisMonthCharges) || 0, balance: Number(d.Balance) || 0 };
  } catch {
    return null;
  }
}

// Build a Bunny Stream embed URL. SERVER-ONLY (signs with the secret token key).
// If BUNNY_STREAM_TOKEN_KEY is set, produces a signed URL that works with Bunny
// "Token Authentication" ON (secure). If not set, returns the plain embed
// (works only when token auth is OFF in the library).
const LIBRARY_ID = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID || "682810";

// `drm` (default true) = token-protected secure player. Pass false for a
// standard, non-DRM class (plain embed, no signed token).
export function bunnyEmbedUrl(videoId: string, drm = true): string {
  const base = `https://iframe.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}`;
  const params = "preload=false&responsive=true";
  const key = process.env.BUNNY_STREAM_TOKEN_KEY;
  if (!drm || !key) return `${base}?${params}`;
  const expires = Math.floor(Date.now() / 1000) + 6 * 3600; // 6 hours
  const token = crypto.createHash("sha256").update(key + videoId + expires).digest("hex");
  return `${base}?token=${token}&expires=${expires}&${params}`;
}
