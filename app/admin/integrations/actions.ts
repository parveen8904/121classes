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

// One-click connect: validate the token (getMe), auto-save the @username, then
// point the bot at our webhook. Don't call redirect() inside try/catch — it
// throws internally and would be swallowed by the catch.
export async function connectTelegramWebhook() {
  if (!(await requireAdmin())) return;
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) redirect("/admin/integrations?tg=notoken");
  const svc = createServiceClient();

  let username: string | null = null;
  try {
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store" }).then((r) => r.json());
    if (me?.ok && me?.result?.username) username = String(me.result.username);
  } catch { /* handled below */ }
  if (!username) redirect("/admin/integrations?tg=badtoken");
  await svc.from("app_secrets").upsert({ key: "TELEGRAM_BOT_USERNAME", value: username }, { onConflict: "key" });
  clearSecretCache();

  const host = headers().get("host");
  const proto = headers().get("x-forwarded-proto") || "https";
  const webhookUrl = `${proto}://${host}/api/telegram/webhook`;
  const secret = await getSecret("TELEGRAM_WEBHOOK_SECRET");
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

// Register the Discord "/ask" slash command (one-time). Uses the bot token + app
// id you pasted above. Global commands can take up to ~1 hour to appear.
export async function registerDiscordCommand() {
  if (!(await requireAdmin())) return;
  const appId = await getSecret("DISCORD_APP_ID");
  const token = await getSecret("DISCORD_BOT_TOKEN");
  if (!appId || !token) redirect("/admin/integrations?discord=missing");
  try {
    const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bot ${token}` },
      body: JSON.stringify({
        name: "ask",
        description: "Ask a CA doubt — answered from CA Parveen Sharma's class material",
        type: 1,
        options: [{ name: "question", description: "Your doubt", type: 3, required: true }],
      }),
      cache: "no-store",
    });
    redirect(`/admin/integrations?discord=${res.ok ? "registered" : "failed"}`);
  } catch {
    redirect("/admin/integrations?discord=failed");
  }
}

// Set a subject's group links/ids: Telegram join link, Telegram chat id (for the
// bot to post), and Discord channel id (for the bot/worker). All optional.
export async function saveSubjectGroup(formData: FormData) {
  if (!(await requireAdmin())) return;
  const subjectId = str(formData.get("subject_id"));
  if (!subjectId) redirect("/admin/integrations?links=saved");
  const svc = createServiceClient();
  await svc
    .from("subjects")
    .update({
      telegram_group_url: str(formData.get("group_url")) || null,
      telegram_group_chat_id: str(formData.get("telegram_group_chat_id")) || null,
      discord_channel_id: str(formData.get("discord_channel_id")) || null,
    })
    .eq("id", subjectId);
  redirect("/admin/integrations?links=saved");
}

// Save the public channel / social links (no code/SQL needed).
export async function saveLinks(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const rows = [
    { key: "support_telegram", value: str(formData.get("support_telegram")) },
    { key: "support_telegram_group", value: str(formData.get("support_telegram_group")) },
    { key: "support_discord", value: str(formData.get("support_discord")) },
    { key: "whatsapp_channel", value: str(formData.get("whatsapp_channel")) },
    { key: "support_whatsapp", value: str(formData.get("support_whatsapp")) },
    { key: "support_instagram", value: str(formData.get("support_instagram")) },
    { key: "support_youtube", value: str(formData.get("support_youtube")) },
    { key: "support_twitter", value: str(formData.get("support_twitter")) },
    { key: "support_facebook", value: str(formData.get("support_facebook")) },
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
  "DISCORD_WEBHOOK_URL",
  "DISCORD_APP_ID",
  "DISCORD_PUBLIC_KEY",
  "DISCORD_BOT_TOKEN",
  "DISCORD_ASK_CHANNELS",
  "ANTHROPIC_API_KEY",
  "MAILGUN_API_KEY",
  "MAILGUN_DOMAIN",
  "MAILGUN_REGION",
  "NOTIFY_FROM_EMAIL",
  "NOTIFY_REPLY_TO",
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
  "JOOBLE_API_KEY",
  "SERPAPI_KEY",
  "BUNNY_STREAM_API_KEY",
  "BUNNY_LIBRARY_ID",
  "BUNNY_ACCOUNT_API_KEY",
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

// Send a test email to FACULTY_EMAIL and surface Mailgun's EXACT response so the
// admin can see why email fails (wrong domain, EU region, from not allowed…).
export async function sendTestEmail() {
  if (!(await requireAdmin())) return;
  const apiKey = await getSecret("MAILGUN_API_KEY");
  const domain = await getSecret("MAILGUN_DOMAIN");
  const to = (await getSecret("FACULTY_EMAIL")) || "";
  const region = (await getSecret("MAILGUN_REGION")).toLowerCase();
  const from = (await getSecret("NOTIFY_FROM_EMAIL")) || `121 CA Classes <no-reply@${domain}>`;
  const apiBase = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  let msg = "";
  if (!apiKey || !domain) msg = "Mailgun API key / domain not set.";
  else if (!to) msg = "Set FACULTY_EMAIL (the address to send the test to).";
  else {
    try {
      const body = new URLSearchParams({ from, to, subject: "121 CA Classes — test email", html: "<p>✅ Mailgun is working.</p>" });
      const res = await fetch(`${apiBase}/v3/${domain}/messages`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      });
      const text = (await res.text()).slice(0, 240);
      msg = res.ok ? `✅ Sent to ${to} (from ${from}). Check the inbox.` : `❌ Mailgun ${res.status}: ${text}`;
    } catch (e) {
      msg = "❌ " + String(e).slice(0, 200);
    }
  }
  redirect(`/admin/integrations?mailtest=${encodeURIComponent(msg)}`);
}
