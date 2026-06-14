import { createServiceClient } from "@/lib/supabase/service";

// Messaging. All SERVER-ONLY. Everything degrades gracefully: if a provider
// isn't configured the send is a no-op and we log status "skipped".

export function emailConfigured(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
}
export function whatsappConfigured(): boolean {
  return Boolean(process.env.INTERAKT_API_KEY);
}
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

// Post one message to the Telegram channel — reaches EVERY member in a single
// API call (scale-safe). The bot must be an admin of the channel.
export async function sendTelegramChannel(text: string, linkUrl?: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const chat = process.env.TELEGRAM_CHANNEL_ID || "@caparveen";
  const body = linkUrl ? `${text}\n\n${linkUrl}` : text;
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
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
export function telegramBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME || "";
}

// Send a direct message to ONE linked student's Telegram chat. Used for the
// doubt-bot replies and for mass *individual* messaging.
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  linkUrl?: string,
): Promise<boolean> {
  if (!telegramConfigured() || !chatId) return false;
  const body = linkUrl ? `${text}\n\n${linkUrl}` : text;
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
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
  if (!emailConfigured() || !to) return false;
  const domain = process.env.MAILGUN_DOMAIN!;
  const from = process.env.NOTIFY_FROM_EMAIL || `121 CA Classes <no-reply@${domain}>`;
  const body = new URLSearchParams({ from, to, subject, html });
  try {
    const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64"),
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
  if (!whatsappConfigured() || !phone) return false;
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return false;
  try {
    const res = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        Authorization: `Basic ${process.env.INTERAKT_API_KEY}`,
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
    <div style="height:4px;background:linear-gradient(90deg,#0d9488,#10b981);border-radius:4px"></div>
    <h2 style="margin:18px 0 8px">${heading}</h2>
    <div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
    <p style="margin-top:24px;color:#64748b;font-size:13px">📚 121 CA Classes — a venture by CA Parveen Sharma.</p>
  </div>`;
}
