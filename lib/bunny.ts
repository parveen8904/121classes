import crypto from "crypto";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

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

// Email the admin once when Bunny's month-to-date charges cross the cap
// (site_settings bunny_cap_usd → cost_alert_email). Called daily by the cron.
export async function maybeBunnyAlert() {
  const bill = await getBunnyBilling();
  if (!bill) return;
  const svc = createServiceClient();
  const get = async (k: string) => (await svc.from("site_settings").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;
  const cap = Number(await get("bunny_cap_usd")) || 0;
  if (cap <= 0 || bill.thisMonth < cap) return;
  const month = new Date().toISOString().slice(0, 7);
  const flagKey = `bunny_alert_sent:${month}`;
  if (await get(flagKey)) return;
  const to = (await get("cost_alert_email")) || "";
  if (to) {
    const { sendEmail } = await import("@/lib/notify");
    await sendEmail(
      to,
      "⚠️ 121 CA Classes — Bunny video cost over budget",
      `<p>Bunny charges this month have reached <strong>$${bill.thisMonth.toFixed(2)}</strong> (cap $${cap.toFixed(2)}).</p><p>See Admin → Costs &amp; usage.</p>`,
    );
  }
  await svc.from("site_settings").upsert({ key: flagKey, value: "1" }, { onConflict: "key" });
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
