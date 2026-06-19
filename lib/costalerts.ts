import { createServiceClient } from "@/lib/supabase/service";

// Email the admin once when Supabase storage crosses the cap
// (site_settings supabase_storage_cap_mb → cost_alert_email). Daily via cron.
export async function maybeStorageAlert() {
  const svc = createServiceClient();
  const get = async (k: string) => (await svc.from("site_settings").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;
  const capMb = Number(await get("supabase_storage_cap_mb")) || 0;
  if (capMb <= 0) return;
  let usedMb = 0;
  try {
    const { data } = await svc.rpc("storage_usage");
    const row = Array.isArray(data) ? data[0] : data;
    usedMb = row ? (Number(row.bytes) || 0) / (1024 * 1024) : 0;
  } catch {
    return;
  }
  if (usedMb < capMb) return;
  const month = new Date().toISOString().slice(0, 7);
  const flagKey = `storage_alert_sent:${month}`;
  if (await get(flagKey)) return;
  const to = (await get("cost_alert_email")) || "";
  if (to) {
    const { sendEmail } = await import("@/lib/notify");
    await sendEmail(
      to,
      "⚠️ 121 CA Classes — Supabase storage near limit",
      `<p>Stored files have reached <strong>${usedMb.toFixed(0)} MB</strong> (cap ${capMb} MB; free tier is ~1024 MB).</p><p>Consider enabling Cloudflare R2 for large files. See Admin → Costs &amp; usage.</p>`,
    );
  }
  await svc.from("site_settings").upsert({ key: flagKey, value: "1" }, { onConflict: "key" });
}
