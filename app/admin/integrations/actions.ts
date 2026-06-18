"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { telegramConfigured } from "@/lib/notify";
import { getSecret, clearSecretCache } from "@/lib/secrets";
import { testRazorpay } from "@/lib/razorpay";
import { str } from "../_lib/util";

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Point the Telegram bot at our webhook (one click).
export async function connectTelegramWebhook() {
  if (!(await requireAdmin())) return;
  if (!(await telegramConfigured())) redirect("/admin/integrations?tg=notoken");

  const host = headers().get("host");
  const proto = headers().get("x-forwarded-proto") || "https";
  const webhookUrl = `${proto}://${host}/api/telegram/webhook`;
  const secret = await getSecret("TELEGRAM_WEBHOOK_SECRET");
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  const params: Record<string, string> = { url: webhookUrl };
  if (secret) params.secret_token = secret;

  let ok = false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  redirect(`/admin/integrations?tg=${ok ? "set" : "fail"}`);
}

// Save the public channel / social links (no code/SQL needed).
export async function saveLinks(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const rows = [
    { key: "support_telegram", value: str(formData.get("support_telegram")) },
    { key: "support_whatsapp", value: str(formData.get("support_whatsapp")) },
    { key: "support_instagram", value: str(formData.get("support_instagram")) },
  ];
  for (const r of rows) {
    await svc.from("site_settings").upsert({ key: r.key, value: r.value }, { onConflict: "key" });
  }
  redirect("/admin/integrations?links=saved");
}

// The provider keys the admin can paste in (stored server-only in app_secrets).
const SECRET_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_CHANNEL_ID",
  "ANTHROPIC_API_KEY",
  "MAILGUN_API_KEY",
  "MAILGUN_DOMAIN",
  "INTERAKT_API_KEY",
  "FACULTY_TELEGRAM_CHAT_ID",
  "FACULTY_EMAIL",
  "CRON_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE",
] as const;

// Save API keys pasted in the admin. Blank fields are IGNORED (so you can update
// one key without wiping the others). Stored in app_secrets — never exposed to
// the browser. A literal "CLEAR" removes a key.
export async function saveSecrets(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  for (const key of SECRET_KEYS) {
    const raw = str(formData.get(key)).trim();
    if (!raw) continue;
    if (raw === "CLEAR") {
      await svc.from("app_secrets").delete().eq("key", key);
    } else {
      await svc.from("app_secrets").upsert(
        { key, value: raw, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    }
  }
  clearSecretCache();
  redirect("/admin/integrations?keys=saved");
}

// Verify the saved Razorpay keys by creating a tiny test order.
export async function testRazorpayConnection() {
  if (!(await requireAdmin())) return;
  const r = await testRazorpay();
  redirect(`/admin/integrations?rzp=${r.ok ? "ok" : "fail"}&rzpmsg=${encodeURIComponent(r.message)}`);
}
