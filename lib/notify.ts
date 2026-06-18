import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// Messaging. All SERVER-ONLY. Everything degrades gracefully: if a provider
// isn't configured the send is a no-op. Keys come from Vercel env OR the
// admin-managed secret store (see lib/secrets.ts), so configured() is async.

export async function emailConfigured(): Promise<boolean> {
  return Boolean((await getSecret("MAILGUN_API_KEY")) && (await getSecret("MAILGUN_DOMAIN")));
}
export async function whatsappConfigured(): Promise<boolean> {
  return Boolean(await getSecret("INTERAKT_API_KEY"));
}
export async function telegramConfigured(): Promise<boolean> {
  return Boolean(await getSecret("TELEGRAM_BOT_TOKEN"));
}

// Post one message to the Telegram channel — reaches EVERY member in a single
// API call (scale-safe). The bot must be an admin of the channel.
export async function sendTelegramChannel(text: string, linkUrl?: string): Promise<boolean> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) return false;
  const chat = (await getSecret("TELEGRAM_CHANNEL_ID")) || "@caparveen";
  const body = linkUrl ? `${text}\n\n${linkUrl}` : text;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: body }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// The bot's @username (no @), used to build personal deep links (t.me/<bot>?start=…).
export async function telegramBotUsername(): Promise<string> {
  return (await getSecret("TELEGRAM_BOT_USERNAME")) || "";
}

// Send a direct message to ONE linked student's Telegram chat. Used for the
// doubt-bot replies and for mass *individual* messaging.
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  linkUrl?: string,
): Promise<boolean> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token || !chatId) return false;
  const body = linkUrl ? `${text}\n\n${linkUrl}` : text;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: body }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = await getSecret("MAILGUN_API_KEY");
  const domain = await getSecret("MAILGUN_DOMAIN");
  if (!apiKey || !domain || !to) return false;
  const from = (await getSecret("NOTIFY_FROM_EMAIL")) || `121 CA Classes <no-reply@${domain}>`;
  const body = new URLSearchParams({ from, to, subject, html });
  try {
    const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Interakt WhatsApp (best-effort — needs a pre-approved template on their side).
export async function sendWhatsApp(
  phone: string,
  templateName: string,
  bodyValues: string[],
): Promise<boolean> {
  const apiKey = await getSecret("INTERAKT_API_KEY");
  if (!apiKey || !phone) return false;
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return false;
  try {
    const res = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        Authorization: `Basic ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        countryCode: "+91",
        phoneNumber: digits,
        type: "Template",
        template: { name: templateName, languageCode: "en", bodyValues },
      }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function record(
  studentId: string | null,
  channel: "email" | "whatsapp",
  template: string,
  payload: Record<string, unknown>,
  ok: boolean,
) {
  try {
    const svc = createServiceClient();
    await svc.from("notifications").insert({
      student_id: studentId,
      channel,
      template,
      payload,
      status: ok ? "sent" : "skipped",
      sent_at: ok ? new Date().toISOString() : null,
    });
  } catch {
    // notifications are best-effort; never block the main flow
  }
}

// Send an email (and log it). Safe to call even with no provider configured.
export async function notifyByEmail(opts: {
  studentId?: string | null;
  email?: string | null;
  subject: string;
  html: string;
  template: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const ok = opts.email ? await sendEmail(opts.email, opts.subject, opts.html) : false;
  await record(opts.studentId ?? null, "email", opts.template, { ...opts.payload, to: opts.email }, ok);
}

// Minimal branded HTML wrapper for emails.
export function emailShell(heading: string, bodyHtml: string): string {
  return `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <div style="height:4px;background:#0d9488;border-radius:4px"></div>
    <h2 style="margin:18px 0 8px">${heading}</h2>
    <div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
    <p style="margin-top:24px;color:#64748b;font-size:13px">📚 121 CA Classes — a venture by CA Parveen Sharma.</p>
  </div>`;
}
