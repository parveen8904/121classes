import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendTelegramMessage, sendWhatsApp, sendEmail, emailShell } from "@/lib/notify";
import { tgSendToGroup } from "@/lib/telegramGroup";
import { discordSendToChannel } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// How many WhatsApp messages one cron pass sends per post. Bigger campaigns
// resume on the next 10-minute pass (wa_offset tracks progress), so a 6000-
// student campaign completes hands-free without blowing the time limit.
const WA_BATCH = 400;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

// Every 10 minutes: post any due campaign messages to their chosen targets —
// Telegram channel / subject groups / Discord / direct DMs / bulk WhatsApp —
// and email the drafted post to admins for Instagram/YouTube (those platforms
// can't be reliably auto-posted, so they are prepare-and-remind).
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data: due } = await svc
    .from("scheduled_posts")
    .select("id, body, link_url, to_tg_channel, to_tg_groups, to_discord, to_direct, campaign, to_whatsapp, wa_template, wa_offset, to_instagram, to_youtube, to_twitter, ig_text, yt_text, status_note")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at")
    .limit(10);
  if (!due?.length) return NextResponse.json({ ok: true, sent: 0 });

  // Targets are shared across posts — fetch once.
  const [channel, { data: subjects }] = await Promise.all([
    getSecret("TELEGRAM_CHANNEL_ID"),
    svc.from("subjects").select("telegram_group_chat_id, discord_channel_id"),
  ]);
  const tgGroups = [...new Set((subjects ?? []).map((s) => s.telegram_group_chat_id as string | null).filter(Boolean))] as string[];
  const dcChannels = [...new Set((subjects ?? []).map((s) => s.discord_channel_id as string | null).filter(Boolean))] as string[];

  // Connected students for direct messages (chat id set when they tapped
  // "Connect Telegram" on their dashboard). Fetched once per run.
  const needDirect = due.some((p) => p.to_direct && (p.wa_offset ?? 0) === 0);
  let directIds: string[] = [];
  if (needDirect) {
    const [{ data: profs }, { data: subs }] = await Promise.all([
      svc.from("profiles").select("telegram_chat_id").not("telegram_chat_id", "is", null),
      svc.from("telegram_subscribers").select("chat_id"),
    ]);
    directIds = [...new Set([
      ...(profs ?? []).map((r) => String(r.telegram_chat_id)),
      ...(subs ?? []).map((r) => String(r.chat_id)),
    ])];
  }

  // WhatsApp audience: every student with a valid Indian mobile on file, plus
  // imported leads (Interakt exports, call lists) that aren't students yet.
  const needWa = due.some((p) => p.to_whatsapp);
  let waPhones: string[] = [];
  if (needWa) {
    const [{ data: profs }, { data: leadRows }] = await Promise.all([
      svc.from("profiles").select("phone").eq("role", "student").not("phone", "is", null),
      svc.from("leads").select("phone").is("matched_user_id", null).not("phone", "is", null),
    ]);
    waPhones = [...new Set(
      [...(profs ?? []), ...(leadRows ?? [])]
        .map((r) => String(r.phone).replace(/\D/g, "").slice(-10))
        .filter((d) => d.length === 10),
    )];
  }

  // Who receives the Instagram/YouTube/Twitter "post this now" reminders. The
  // founder can route them to a staff member (site_settings marketing_poster_
  // emails, comma-separated); falls back to the admins.
  const needRemind = due.some((p) => (p.to_instagram || p.to_youtube || p.to_twitter) && (p.wa_offset ?? 0) === 0);
  let adminEmails: string[] = [];
  if (needRemind) {
    const { data: cfg } = await svc.from("site_settings").select("value").eq("key", "marketing_poster_emails").maybeSingle();
    const configured = String(cfg?.value ?? "").split(/[,\s;]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
    if (configured.length) {
      adminEmails = configured.slice(0, 5);
    } else {
      const { data: admins } = await svc.from("profiles").select("email").eq("role", "admin").not("email", "is", null).limit(5);
      adminEmails = (admins ?? []).map((a) => String(a.email));
    }
  }

  let sent = 0;
  for (const p of due) {
    const text = p.link_url ? `${p.body}\n\n${p.link_url}` : p.body;
    // A resumed WhatsApp post already did its channels on the first pass.
    const firstPass = (p.wa_offset ?? 0) === 0;
    const notes: string[] = firstPass ? [] : String(p.status_note ?? "").split("; ").filter((n) => n && !n.startsWith("whatsapp:"));
    try {
      if (firstPass) {
        if (p.to_tg_channel) {
          if (channel) { if (!(await sendTelegramMessage(channel, text))) notes.push("channel failed"); }
          else notes.push("no channel configured");
        }
        if (p.to_tg_groups) {
          if (!tgGroups.length) notes.push("no groups linked");
          for (const g of tgGroups) { if (!(await tgSendToGroup(g, text))) notes.push(`group ${g} failed`); }
        }
        if (p.to_discord) {
          if (!dcChannels.length) notes.push("no discord channels linked");
          for (const c of dcChannels) { if (!(await discordSendToChannel(c, text))) notes.push(`discord ${c} failed`); }
        }
        if (p.to_direct) {
          if (!directIds.length) notes.push("no students have connected Telegram yet");
          let ok = 0, fail = 0;
          for (const chatId of directIds) {
            if (await sendTelegramMessage(chatId, text)) ok++; else fail++;
            // Stay under Telegram's ~30 messages/second bot limit.
            if ((ok + fail) % 25 === 0) await new Promise((r) => setTimeout(r, 1100));
          }
          notes.push(`direct: ${ok} delivered${fail ? `, ${fail} failed (blocked the bot / left)` : ""}`);
        }
        // Instagram / YouTube — prepare-and-remind: email the drafted post to
        // the admins to publish manually (auto-posting isn't reliably possible).
        if (p.to_instagram || p.to_youtube || p.to_twitter) {
          const platforms = [
            p.to_instagram ? "Instagram" : null,
            p.to_youtube ? "YouTube" : null,
            p.to_twitter ? "Twitter/X" : null,
          ].filter(Boolean).join(", ");
          if (!adminEmails.length) notes.push("social reminder: no email set");
          else {
            // Platform-specific variants when the post carries them (campaign packs).
            const igBlock = p.to_instagram
              ? `<p style="margin:14px 0 4px"><strong>📷 Instagram caption</strong></p><div style="background:#f4f4f5;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:15px">${esc(String(p.ig_text ?? text))}</div>`
              : "";
            const ytBlock = p.to_youtube
              ? `<p style="margin:14px 0 4px"><strong>▶️ YouTube community post</strong></p><div style="background:#f4f4f5;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:15px">${esc(String(p.yt_text ?? text))}</div>`
              : "";
            const twBlock = p.to_twitter
              ? `<p style="margin:14px 0 4px"><strong>🐦 Twitter/X post</strong> <span style="color:#888;font-size:12px">(trim to 280 characters)</span></p><div style="background:#f4f4f5;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:15px">${esc(String(text).slice(0, 275))}</div>`
              : "";
            const html = emailShell(`📣 Post this on ${platforms}`,
              `<p>Your campaign${p.campaign ? ` <strong>${esc(String(p.campaign))}</strong>` : ""} is going out now. Ready-to-paste content:</p>
               ${igBlock}${ytBlock}${twBlock}
               <p style="font-size:13px;color:#666">Copy the text into each app. (These platforms don't allow reliable auto-posting, so this reminder is your cue.)</p>`);
            let ok = 0;
            for (const to of adminEmails) if (await sendEmail(to, `📣 Post to ${platforms} now — campaign is live`, html).catch(() => false)) ok++;
            notes.push(`social reminder emailed${ok ? "" : " FAILED"}`);
          }
        }
      }

      // WhatsApp bulk — batched; resumes across cron passes via wa_offset.
      if (p.to_whatsapp) {
        const template = String(p.wa_template ?? "").trim();
        if (!waPhones.length) notes.push("whatsapp: no student phone numbers on file");
        else if (!template) notes.push("whatsapp: skipped — no approved template name set");
        else {
          // Template variables can't contain newlines — flatten the message.
          const waText = text.replace(/\s+/g, " ").trim().slice(0, 900);
          const start = p.wa_offset ?? 0;
          const batch = waPhones.slice(start, start + WA_BATCH);
          let ok = 0, fail = 0;
          for (let i = 0; i < batch.length; i += 8) {
            const results = await Promise.all(batch.slice(i, i + 8).map((ph) => sendWhatsApp(ph, template, [waText]).catch(() => false)));
            for (const r of results) r ? ok++ : fail++;
          }
          const done = start + batch.length;
          if (done < waPhones.length) {
            await svc.from("scheduled_posts").update({
              wa_offset: done,
              status_note: [...notes, `whatsapp: ${done}/${waPhones.length} sent — continuing…`].join("; ").slice(0, 300),
            }).eq("id", p.id);
            continue; // stays pending; the next 10-minute pass sends the next batch
          }
          notes.push(`whatsapp: finished all ${waPhones.length} numbers (last batch: ${ok} delivered${fail ? `, ${fail} failed` : ""})`);
        }
      }

      await svc.from("scheduled_posts").update({
        status: "sent",
        status_note: notes.length ? notes.join("; ").slice(0, 300) : null,
        sent_at: new Date().toISOString(),
      }).eq("id", p.id);
      sent++;
    } catch (e) {
      await svc.from("scheduled_posts").update({ status: "failed", status_note: e instanceof Error ? e.message : "error" }).eq("id", p.id);
    }
  }
  return NextResponse.json({ ok: true, sent });
}
