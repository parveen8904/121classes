import { createServiceClient } from "@/lib/supabase/service";
import { toE164Digits } from "@/lib/phoneNumber";
import { getSecret } from "@/lib/secrets";
import { unsubscribeUrl, unsubscribePostUrl } from "@/lib/unsubscribe";

// Messaging. All SERVER-ONLY. Everything degrades gracefully: if a provider
// isn't configured the send is a no-op. Keys come from Vercel env OR the
// admin-managed secret store (see lib/secrets.ts), so configured() is async.

export async function emailConfigured(): Promise<boolean> {
  return Boolean((await getSecret("MAILGUN_API_KEY")) && (await getSecret("MAILGUN_DOMAIN")));
}
export async function whatsappConfigured(): Promise<boolean> {
  return Boolean(await getSecret("WHATSAPP_CLOUD_TOKEN"));
}
export async function telegramConfigured(): Promise<boolean> {
  return Boolean(await getSecret("TELEGRAM_BOT_TOKEN"));
}

// Post one message to the Telegram channel — reaches EVERY member in a single
// API call (scale-safe). The bot must be an admin of the channel.
/**
 * WHAT TELEGRAM WILL ACTUALLY ACCEPT AS A CHAT.
 *
 * The channel had been stored as "https://t.me/aldineho" — the address you copy
 * out of the browser, and the obvious thing to paste into a box labelled
 * "Telegram channel". The API takes "@aldineho" or a numeric id and rejects a
 * URL, so every channel broadcast had been failing: the send returned false and
 * nothing said so. Found when the toppers announcement reported the channel ✗
 * while both groups went through.
 *
 * Rather than only correcting the stored value, whatever he pastes is now
 * understood: a t.me link, an @handle, a bare handle, or a numeric id.
 */
export function telegramChatId(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (/^-?\d+$/.test(v)) return v;                        // numeric chat id
  const fromUrl = v.match(/^https?:\/\/t\.me\/(?:s\/)?([A-Za-z0-9_]+)/i);
  if (fromUrl) return `@${fromUrl[1]}`;
  if (v.startsWith("@")) return v;
  if (/^[A-Za-z0-9_]{4,}$/.test(v)) return `@${v}`;        // bare handle
  return v;                                                 // leave it; the API will say
}

// HOW TO MAKE IT STOP, ON THE MESSAGE ITSELF.
//
// An unsubscribe nobody can find is not an unsubscribe. Email carries a link
// and a header; on Telegram and WhatsApp there is no header to carry, so the
// instruction rides on the message — one short line, the same words on both,
// and both webhooks act on it.
const STOP_LINE = "Reply STOP to stop these messages.";

export async function sendTelegramChannel(text: string, linkUrl?: string): Promise<boolean> {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) return false;
  const chat = telegramChatId(await getSecret("TELEGRAM_CHANNEL_ID")) || "@caparveen";
  const body = linkUrl ? `${text}\n\n${linkUrl}` : text;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: body }),
      cache: "no-store",
    });
    // Loud on refusal. A channel that quietly rejects every post looks exactly
    // like a channel nobody reads — which is how a URL sat in the chat-id field
    // for weeks without anybody knowing the broadcasts were going nowhere.
    if (!res.ok) console.error(`[telegram] channel ${chat} refused the post: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (e) {
    console.error(`[telegram] channel post threw: ${e instanceof Error ? e.message : "unknown"}`);
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
  // The same guard email has, at the one place a PERSON is messaged on
  // Telegram. sendTelegramChannel below is the public channel, which nobody is
  // subscribed to individually and which /stop cannot mean.
  if (await isBlocked(String(chatId), "telegram")) return false;
  const body = linkUrl
    ? `${text}\n\n${linkUrl}\n\n${STOP_LINE}`
    : `${text}\n\n${STOP_LINE}`;
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

export type SendEmailOpts = {
  /** Adds the Importance: high header most clients show as a mark. Use
   * sparingly — flagging everything "important" is itself a spam signal.
   * Deliberately NOT X-Priority: 1: spam filters score that header harshly
   * on lookalike bulk mail, and inbox placement beats a red flag. */
  important?: boolean;
  /** One of many near-identical messages (the complimentary drip). Adds a
   * List-Unsubscribe header — mailbox providers treat bulk mail without one
   * with suspicion, and its presence measurably helps inbox placement. */
  bulk?: boolean;
  /** Blind-copy this address. Used for AI replies so he sees every answer that
   * went out in his name, without the student knowing he was copied. */
  bcc?: string;
};

/** Who gets a blind copy of every answer the AI sends in his name. Held as a
 * secret so the address can be changed or emptied without a deploy. */
export async function aiReplyBcc(): Promise<string> {
  return (await getSecret("AI_REPLY_BCC")).trim();
}

// PEOPLE THIS SYSTEM MAY NOT EMAIL, WHATEVER IS ASKING.
//
// Every previous fix was aimed at a cause — the re-engagement ladder that could
// not record its sends, the auto-reply that counted "Re:" prefixes. Each was
// real, each was fixed, and mail kept arriving, because there was always one
// more sender nobody had thought of. Three times the founder had to ask again.
//
// So this is deliberately NOT aimed at a cause. It sits at the one place every
// message must pass, which means a listed address is unreachable from the
// ladder, the auto-reply, the digests, the crons, and from anything written
// next year by somebody who never read this comment.
//
// EVERY CHANNEL, ONE LIST. Widened 4 September 2026 — "Do it for telegram and
// WhatsApp also". A second list would have been the same mistake in a new
// shape: the day somebody writes a sender that checks the wrong one, a student
// who asked us to stop gets messaged.
//
// Add one with:
//   insert into email_blocklist (channel, email, reason) values ('telegram', …)
export type Channel = "email" | "whatsapp" | "telegram";

export async function isBlocked(to: string, channel: Channel = "email"): Promise<boolean> {
  try {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const svc = createServiceClient();
    // Addresses are compared lowercased; a phone number or chat id is digits
    // and unaffected by it, so one rule serves all three.
    const addr = to.trim().toLowerCase();
    const { data } = await svc.from("email_blocklist").select("email")
      .eq("channel", channel).eq("email", addr).maybeSingle();
    if (!data) return false;
    // Counted, so the size of a problem is visible rather than guessed at.
    await svc.rpc("note_email_blocked", { p_email: addr }).then(() => null, () => null);
    console.error(`[${channel}] BLOCKED — ${addr} asked us to stop. The message was suppressed.`);
    return true;
  } catch {
    // A database wobble must not become a licence to send. Anything we cannot
    // verify as safe is treated as safe to send ONLY because the alternative —
    // silently dropping every email in the system — is worse; but the error is
    // loud so it cannot pass unnoticed.
    console.error("[notify] could not read the blocklist; proceeding");
    return false;
  }
}

export async function sendEmail(to: string, subject: string, html: string, opts: SendEmailOpts = {}): Promise<boolean> {
  const apiKey = await getSecret("MAILGUN_API_KEY");
  const domain = await getSecret("MAILGUN_DOMAIN");
  if (!apiKey || !domain || !to) return false;
  if (await isBlocked(to)) return false;
  // The address may stay noreply@… but the NAME the inbox shows must be his.
  // A bare address in NOTIFY_FROM_EMAIL used to surface as "noreply" in the
  // recipient's inbox — wrap it in a display name unless one is already set.
  let from = (await getSecret("NOTIFY_FROM_EMAIL")) || `CA Parveen Sharma <no-reply@${domain}>`;
  if (!from.includes("<")) from = `CA Parveen Sharma <${from}>`;
  // EU-region Mailgun domains MUST use the EU API host, or sends silently fail.
  const region = (await getSecret("MAILGUN_REGION")).toLowerCase();
  const apiBase = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  const body = new URLSearchParams({ from, to, subject, html });
  const replyTo = await getSecret("NOTIFY_REPLY_TO");
  if (replyTo) body.set("h:Reply-To", replyTo);
  if (opts.bcc) body.set("bcc", opts.bcc);
  if (opts.important) body.set("h:Importance", "high");

  // A WAY OUT, ON EVERY MESSAGE, PUT HERE SO NOBODY CAN FORGET IT.
  //
  // "Where is the unsubscribe option?" — the founder, 4 September 2026, after a
  // student had received nine emails he never asked for and could do nothing
  // about it but reply angrily.
  //
  // There WAS a List-Unsubscribe header, but only when a caller remembered to
  // pass `bulk: true`, and the job that pestered him did not. A rule that has
  // to be remembered is a rule that will be missed by whoever writes the next
  // sender. So it lives at the one place every message already passes — the
  // same place the blocklist is checked, two lines above — and applies to all
  // of them.
  //
  // Both forms, because they are read by different things: the HEADER is what
  // Gmail and Outlook turn into their own one-click "Unsubscribe" beside the
  // sender's name, and the LINK in the footer is what a person looks for when
  // the client shows no such button. mailto stays alongside the URL as the
  // fallback for clients that only understand that.
  const unsubTo = replyTo || `contact@${domain}`;
  const unsubLink = await unsubscribeUrl(to).catch(() => "");
  const unsubPost = await unsubscribePostUrl(to).catch(() => "");
  body.set(
    "h:List-Unsubscribe",
    unsubPost ? `<${unsubPost}>, <mailto:${unsubTo}?subject=unsubscribe>` : `<mailto:${unsubTo}?subject=unsubscribe>`,
  );
  if (unsubLink) {
    // One-click, as the header spec requires: providers POST to the URL rather
    // than making the reader open a page. Our page treats a POST as the press.
    body.set("h:List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
    body.set(
      "html",
      `${html}<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#6b7280">`
        + `You are receiving this because you have an account with CA Parveen Sharma. `
        + `<a href="${unsubLink}" style="color:#6b7280">Unsubscribe</a> and we will stop emailing this address.`
        + `</div>`,
    );
  }
  try {
    const res = await fetch(`${apiBase}/v3/${domain}/messages`, {
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

// Send an email with a file attachment (e.g. a generated PDF) via Mailgun
// multipart. Returns false (no-op) if the provider isn't configured.
export type EmailAttachment = { filename: string; content: Buffer; contentType: string };

export async function sendEmailWithAttachment(
  to: string,
  subject: string,
  html: string,
  attachment: EmailAttachment | EmailAttachment[],
): Promise<boolean> {
  const apiKey = await getSecret("MAILGUN_API_KEY");
  const domain = await getSecret("MAILGUN_DOMAIN");
  if (!apiKey || !domain || !to) return false;
  let from = (await getSecret("NOTIFY_FROM_EMAIL")) || `CA Parveen Sharma <no-reply@${domain}>`;
  if (!from.includes("<")) from = `CA Parveen Sharma <${from}>`;
  const region = (await getSecret("MAILGUN_REGION")).toLowerCase();
  const apiBase = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  try {
    const form = new FormData();
    form.set("from", from);
    form.set("to", to);
    form.set("subject", subject);
    form.set("html", html);
    const replyTo = await getSecret("NOTIFY_REPLY_TO");
    if (replyTo) form.set("h:Reply-To", replyTo);
    // Mailgun accepts several `attachment` parts on one message.
    for (const a of Array.isArray(attachment) ? attachment : [attachment]) {
      form.append("attachment", new Blob([new Uint8Array(a.content)], { type: a.contentType }), a.filename);
    }
    const res = await fetch(`${apiBase}/v3/${domain}/messages`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64") },
      body: form,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// WhatsApp Cloud API (direct Meta — replaced Interakt so there is no
// middleman subscription). Templates must be approved on the WABA first;
// sendWhatsAppText works only inside a 24h customer-service window.
// Every WhatsApp send is written down — including the ones that fail.
//
// Nothing was recorded before, and Meta's error body was thrown away, so the
// inbox showed a column of student messages with no replies beside them and
// there was no way to tell whether a reply had gone, been refused by Meta, or
// never been attempted. That silence is exactly what made 75 messages look
// unanswered. A send that fails now says WHY, in the same thread.
async function waSend(
  payload: Record<string, unknown>,
  kind: "outbound" | "outbound_template" = "outbound",
): Promise<boolean> {
  const token = await getSecret("WHATSAPP_CLOUD_TOKEN");
  const phoneId = await getSecret("WHATSAPP_PHONE_NUMBER_ID");
  const to = String(payload.to ?? "");
  // Every WhatsApp message in this codebase goes through here — text, template
  // and image alike — which is why the check is here and not in each caller.
  if (await isBlocked(to, "whatsapp")) {
    await record(null, "whatsapp", kind, { to, error: "recipient asked us to stop" }, false);
    return false;
  }
  if (!token || !phoneId) {
    await record(null, "whatsapp", kind, { ...payload, error: "WhatsApp is not configured" }, false);
    return false;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v23.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      cache: "no-store",
    });
    if (res.ok) {
      await record(null, "whatsapp", kind, payload, true);
      return true;
    }
    // Meta explains its refusals properly — outside the 24-hour window, an
    // unapproved template, a blocked number. Worth keeping, every time.
    const why = await res.text().catch(() => "");
    await record(null, "whatsapp", kind, { ...payload, to, error: why.slice(0, 800), http: res.status }, false);
    return false;
  } catch (e) {
    await record(null, "whatsapp", kind, { ...payload, to, error: e instanceof Error ? e.message : String(e) }, false);
    return false;
  }
}

// One rule for every number this system dials or messages — see
// lib/phoneNumber.ts. This used to say "ten digits gain 91, anything longer
// already has a country code", which sent 09876543210 to country code ZERO.
const waNumber = (phone: string): string => toE164Digits(phone);

export async function sendWhatsApp(
  phone: string,
  templateName: string,
  bodyValues: string[],
  opts?: {
    lang?: string;
    buttonSubType?: "url" | "quick_reply" | "copy_code";
    buttonIndex?: string;
    buttonParam?: string;
    /**
     * A template whose header is an IMAGE must be given that image on EVERY
     * send — the picture uploaded when the template was created is only an
     * example for Meta's reviewer, not the picture students receive. Leaving
     * this out is rejected with "header component missing", which reads like the
     * template is broken when it is only unfed.
     */
    headerImageUrl?: string;
  },
): Promise<boolean> {
  const to = waNumber(phone);
  if (to.length < 11 || !templateName) return false;
  const components: Record<string, unknown>[] = [];
  if (opts?.headerImageUrl) {
    components.push({ type: "header", parameters: [{ type: "image", image: { link: opts.headerImageUrl } }] });
  }
  if (bodyValues.length) {
    components.push({ type: "body", parameters: bodyValues.map((t) => ({ type: "text", text: t })) });
  }
  // Authentication templates repeat the code in the button payload; without
  // this component Meta rejects the send.
  if (opts?.buttonParam) {
    components.push({
      type: "button",
      sub_type: opts.buttonSubType ?? "url",
      index: opts.buttonIndex ?? "0",
      parameters: [{ type: "text", text: opts.buttonParam }],
    });
  }
  // Marketing and reminder blasts are recorded separately, so a 500-student
  // campaign does not bury the conversations in the inbox.
  return waSend(
    {
      to,
      type: "template",
      template: { name: templateName, language: { code: opts?.lang ?? "en_US" }, components },
    },
    "outbound_template",
  );
}

/** Free-form text — delivered only inside an open 24h session window. */
export async function sendWhatsAppText(phone: string, text: string): Promise<boolean> {
  const to = waNumber(phone);
  if (to.length < 11 || !text.trim()) return false;
  return waSend({ to, type: "text", text: { body: text.slice(0, 4096) } });
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

// Alert the faculty (founder) that something needs a human reply — e.g. a doubt
// the AI couldn't answer from the repository. Sends a Telegram DM (if a faculty
// chat id is set) and an email. Best-effort; never throws.
export async function notifyFaculty(title: string, body: string): Promise<void> {
  try {
    const facultyChat = await getSecret("FACULTY_TELEGRAM_CHAT_ID");
    if (facultyChat) await sendTelegramMessage(facultyChat, `🔔 ${title}\n\n${body}`);
  } catch {
    /* ignore */
  }
  try {
    // THE SITE MUST NOT WRITE TO THE ADDRESS STUDENTS REPLY TO.
    //
    // contact@ was doing two incompatible jobs: it is where a student's reply
    // lands (NOTIFY_REPLY_TO) AND it was where the site sent its own alerts
    // (FACULTY_EMAIL). contact@ forwards into the inbound bridge, so every
    // "🔔 a student doubt needs your reply" came straight back in as though a
    // student had written it. Eighty-seven of them in a week.
    //
    // The guard on the way in catches them, so they are filed as ignored rather
    // than answered — but a machine writing to itself and being ignored on
    // arrival is a loop that merely fails quietly, and it only takes one gap in
    // the guard for it to be loud. sir@ never had this problem because sir@ was
    // only ever a forwarding address, never a destination we send to.
    //
    // So if the two are set to the same address, the alert goes to the backup
    // address instead — which does not forward anywhere — and says why.
    const reply = bareAddr(await getSecret("NOTIFY_REPLY_TO"));
    // FALLING BACK TO contact@ IS FALLING BACK INTO THE LOOP.
    //
    // If FACULTY_EMAIL is ever cleared, this used to default to the one address
    // that forwards into our own inbox — quietly rebuilding the thing it was
    // written to prevent. The backup address is the safe default; if there is
    // none, the alert is dropped rather than posted back to ourselves.
    let facultyEmail = (await getSecret("FACULTY_EMAIL")) || (await getSecret("BACKUP_EMAIL")) || "";
    if (!facultyEmail) return;
    let note = "";
    if (reply && bareAddr(facultyEmail) === reply) {
      const backup = (await getSecret("BACKUP_EMAIL")).trim();
      if (backup && bareAddr(backup) !== reply) {
        facultyEmail = backup;
        note =
          `<hr><p style="color:#666;font-size:12px">Sent here rather than to ${reply} because that is the address ` +
          `students reply to, and it forwards into the site's own inbox — alerts sent there come back in as though ` +
          `a student had written them. Set FACULTY_EMAIL on the Integrations page to an address that does not ` +
          `forward, and this note will stop.</p>`;
      }
    }
    await sendEmail(facultyEmail, `🔔 ${title}`, emailShell(title, body.replace(/\n/g, "<br/>") + note));
  } catch {
    /* ignore */
  }
}

/** "Name <a@b.com>" → "a@b.com", lowercased. */
function bareAddr(v: string): string {
  const m = String(v ?? "").match(/<([^>]+)>/);
  return (m ? m[1] : String(v ?? "")).trim().toLowerCase();
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
    <p style="margin-top:24px;color:#64748b;font-size:13px">📚 CA Parveen Sharma — Personalised CA coaching.</p>
  </div>`;
}
