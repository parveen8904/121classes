import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendTelegramMessage, sendWhatsApp, sendEmail, emailShell } from "@/lib/notify";
import { tgSendToGroup } from "@/lib/telegramGroup";
import { discordSendToChannel } from "@/lib/discord";
import { selectAll } from "@/lib/pageAll";

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

  // The complimentary-grant drip rides this 10-minute cron. THREE per pass —
  // ~18/hour, ~430/day, a 1,500-student list in about 3½ days. Deliberately
  // slow: this domain normally sends ~16 emails a day, and reputation is
  // earned by volume that grows gently, not by a 200× overnight spike.
  // Best-effort — a queue problem must never block the campaign posts below.
  let drip: { sent: number; remaining: number } | null = null;
  try {
    const { processGrantQueue } = await import("@/lib/grantQueue");
    const r = await processGrantQueue(3, 60_000);
    if (r.sent || r.skipped || r.failed || r.remaining) drip = { sent: r.sent, remaining: r.remaining };
  } catch { /* next pass retries */ }

  // Threads long-lived tokens die at 60 days unless refreshed; a weekly
  // refresh from here keeps the connection alive forever.
  try {
    const { refreshThreadsTokenIfDue } = await import("@/lib/threads");
    await refreshThreadsTokenIfDue();
  } catch { /* next pass retries */ }

  const svc = createServiceClient();
  const { data: due } = await svc
    .from("scheduled_posts")
    .select("id, body, link_url, to_tg_channel, to_tg_groups, to_discord, to_direct, campaign, to_whatsapp, wa_template, wa_offset, to_instagram, to_youtube, to_yt_video, to_twitter, to_linkedin, to_facebook, to_substack, to_medium, to_reddit, to_quora, to_google, to_threads, to_ig_personal, ig_text, yt_text, x_text, video_url, status_note")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at")
    .limit(10);
  if (!due?.length) return NextResponse.json({ ok: true, sent: 0, ...(drip ? { drip } : {}) });

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
    // Paged. Read plainly, these stop at a thousand and the broadcast quietly
    // reaches a fraction of the people it names.
    const [profs, subs] = await Promise.all([
      selectAll<{ telegram_chat_id: string }>((f, t) =>
        svc.from("profiles").select("telegram_chat_id").not("telegram_chat_id", "is", null).range(f, t)),
      selectAll<{ chat_id: string }>((f, t) =>
        svc.from("telegram_subscribers").select("chat_id").range(f, t)),
    ]);
    directIds = [...new Set([
      ...profs.map((r) => String(r.telegram_chat_id)),
      ...subs.map((r) => String(r.chat_id)),
    ])];
  }

  // WhatsApp audience: every student with a valid Indian mobile on file, plus
  // imported leads (Interakt exports, call lists) that aren't students yet.
  const needWa = due.some((p) => p.to_whatsapp);
  let waPhones: string[] = [];
  if (needWa) {
    // There are more than two thousand students and a quarter of a million
    // leads. Unpaged, this addressed a thousand of each — so a campaign that
    // reported success had reached well under one percent of the list.
    const [profs, leadRows] = await Promise.all([
      selectAll<{ phone: string }>((f, t) =>
        svc.from("profiles").select("phone").eq("role", "student").not("phone", "is", null).range(f, t)),
      selectAll<{ phone: string }>((f, t) =>
        svc.from("leads").select("phone").is("matched_user_id", null).not("phone", "is", null).range(f, t)),
    ]);
    waPhones = [...new Set(
      [...profs, ...leadRows]
        .map((r) => String(r.phone).replace(/\D/g, "").slice(-10))
        .filter((d) => d.length === 10),
    )];
  }

  // Who receives the Instagram/YouTube/Twitter "post this now" reminders. The
  // founder can route them to a staff member (site_settings marketing_poster_
  // emails, comma-separated); falls back to the admins.
  const needRemind = due.some((p) => (p.to_instagram || p.to_youtube || p.to_yt_video || p.to_twitter || p.to_linkedin || p.to_facebook || p.to_substack || p.to_medium || p.to_reddit || p.to_quora || p.to_google) && (p.wa_offset ?? 0) === 0);
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
        // Instagram — AUTO-POST via the Meta Graph API when keys are set
        // (professional account + long-lived token in Admin → Integrations).
        // The auto-generated 1080×1080 card is the image; ig_text the caption.
        // A campaign carrying a video goes out as a REEL; the still card is what
        // happens when there is no video, not the other way round. Instagram's
        // feed is video now, and a card posted there reaches almost nobody.
        const videoUrl = String(p.video_url ?? "").trim();
        let igPosted = false;
        if (p.to_instagram) {
          const { igConfigured, publishInstagramImage, publishInstagramReel } = await import("@/lib/instagram");
          if (await igConfigured()) {
            const caption = String(p.ig_text ?? text);
            const res = videoUrl
              ? await publishInstagramReel({ videoUrl, caption })
              : await publishInstagramImage({
                  imageUrl: `https://caparveensharma.com/api/campaign-card/${p.id}?fmt=jpg`,
                  caption,
                });
            if (res.ok) { igPosted = true; notes.push(videoUrl ? "instagram reel: posted ✅" : "instagram: posted ✅"); }
            else notes.push(`instagram: auto-post failed (${res.error}) — reminder emailed instead`);
          }
        }

        // LinkedIn / X / Facebook / Reddit — AUTO-POST via their official APIs
        // when keys are set (Admin → Integrations); reminder email otherwise.
        let liPosted = false, xPosted = false, fbPosted = false, rdPosted = false;
        {
          const social = await import("@/lib/socialPost");
          const full = text + (p.link_url ? `\n\n${p.link_url}` : "");
          if (p.to_linkedin && (await social.linkedinConfigured())) {
            const r = await social.postToLinkedIn(full);
            if (r.ok) { liPosted = true; notes.push("linkedin: posted ✅"); }
            else notes.push(`linkedin: auto-post failed (${r.error}) — reminder emailed instead`);
          }
          if (p.to_twitter && (await social.twitterConfigured())) {
            // X has its own written version when the post carries one.
            const r = await social.postToX(p.x_text ? String(p.x_text) : full);
            if (r.ok) { xPosted = true; notes.push("x/twitter: posted ✅"); }
            else notes.push(`x/twitter: auto-post failed (${r.error}) — reminder emailed instead`);
          }
          if (p.to_twitter && !xPosted) {
            // No X developer keys? Buffer's queue does the posting — the
            // founder's free Buffer account, one API key, no X app at all.
            const { bufferConfigured, bufferPostToX } = await import("@/lib/buffer");
            if (await bufferConfigured()) {
              const r = await bufferPostToX(p.x_text ? String(p.x_text) : full, "shareNow");
              if (r.ok) { xPosted = true; notes.push("x via buffer: posted ✅"); }
              else notes.push(`x via buffer: failed (${r.error}) — reminder emailed instead`);
            }
          }
          if (p.to_facebook && (await social.facebookConfigured())) {
            // Same rule as Instagram: a video becomes a Facebook Reel, and only
            // a campaign with no video goes out as text and a link.
            const r = videoUrl
              ? await social.postFacebookVideo(videoUrl, text)
              : await social.postToFacebook(text, p.link_url ? String(p.link_url) : null);
            if (r.ok) { fbPosted = true; notes.push(videoUrl ? "facebook reel: posted ✅" : "facebook: posted ✅"); }
            else notes.push(`facebook: auto-post failed (${r.error}) — reminder emailed instead`);
          }

          // YouTube Shorts. Reminder-only until the channel is connected with
          // OAuth — an API key can read the channel but never publish to it.
          if (p.to_yt_video && videoUrl) {
            const { youtubeUploadConfigured, uploadYouTubeShort } = await import("@/lib/youtubeUpload");
            if (await youtubeUploadConfigured()) {
              const r = await uploadYouTubeShort({
                videoUrl,
                title: String(p.yt_text ?? text).split("\n")[0].slice(0, 90),
                description: String(p.yt_text ?? text),
              });
              if (r.ok) notes.push("youtube short: posted ✅");
              else notes.push(`youtube short: upload failed (${r.error}) — reminder emailed instead`);
            }
          }
          if (p.to_ig_personal) {
            // Personal Instagram rides Buffer: the Graph API cannot reach it,
            // because the page already has the company account linked.
            const { bufferIgPersonalConfigured, bufferPostToInstagram } = await import("@/lib/buffer");
            if (await bufferIgPersonalConfigured()) {
              const r = await bufferPostToInstagram(
                String(p.ig_text ?? text),
                `https://caparveensharma.com/api/campaign-card/${p.id}?fmt=jpg`,
                "shareNow",
              );
              if (r.ok) notes.push("instagram (personal): posted ✅");
              else notes.push(`instagram (personal): failed (${r.error}) — reminder emailed instead`);
            }
          }
          if (p.to_threads) {
            const { threadsConfigured, postToThreads } = await import("@/lib/threads");
            if (await threadsConfigured()) {
              const r = await postToThreads(p.x_text ? String(p.x_text) : full);
              if (r.ok) notes.push("threads: posted ✅");
              else notes.push(`threads: auto-post failed (${r.error}) — reminder emailed instead`);
            }
          }
          if (p.to_reddit && (await social.redditConfigured())) {
            // Reddit posts are title + body. The copy is written with its own
            // title on the first line; fall back to the campaign name only if
            // that line is missing or unusable as a title.
            const lines = String(p.body).split("\n");
            const head = lines[0].trim();
            const ownTitle = head.length >= 15 && head.length <= 290;
            const title = ownTitle ? head : String(p.campaign || text).split("\n")[0].slice(0, 290);
            const r = await social.postToReddit(title, ownTitle ? lines.slice(1).join("\n").trim() : full);
            if (r.ok) { rdPosted = true; notes.push("reddit: posted ✅"); }
            else notes.push(`reddit: auto-post failed (${r.error}) — reminder emailed instead`);
          }
        }

        // Prepare-and-remind channels — email the drafted post to the team to
        // publish manually (none of these allow reliable auto-posting).
        if ((p.to_instagram && !igPosted) || p.to_youtube || p.to_yt_video || (p.to_twitter && !xPosted) || (p.to_linkedin && !liPosted) || (p.to_facebook && !fbPosted) || p.to_substack || p.to_medium || (p.to_reddit && !rdPosted) || p.to_quora || p.to_google) {
          const platforms = [
            p.to_instagram && !igPosted ? "Instagram" : null,
            p.to_youtube ? "YouTube" : null,
            p.to_yt_video ? "a YouTube video" : null,
            p.to_twitter && !xPosted ? "Twitter/X" : null,
            p.to_linkedin && !liPosted ? "LinkedIn" : null,
            p.to_facebook && !fbPosted ? "Facebook" : null,
            p.to_substack ? "Substack" : null,
            p.to_medium ? "Medium" : null,
            p.to_reddit && !rdPosted ? "Reddit" : null,
            p.to_quora ? "Quora" : null,
            p.to_google ? "Google Business Profile" : null,
          ].filter(Boolean).join(", ");
          if (!adminEmails.length) notes.push("social reminder: no email set");
          else {
            // Platform-specific variants when the post carries them (campaign packs).
            const cardUrl = `https://caparveensharma.com/api/campaign-card/${p.id}`;
            const igBlock = p.to_instagram && !igPosted
              ? `<p style="margin:14px 0 4px"><strong>📷 Instagram caption</strong></p><div style="background:#f4f4f5;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:15px">${esc(String(p.ig_text ?? text))}</div>
                 <p style="margin:14px 0 4px"><strong>🖼️ Ready-made image (1080×1080)</strong> — long-press / right-click to save, then attach in Instagram:</p>
                 <a href="${cardUrl}" target="_blank"><img src="${cardUrl}" alt="Instagram card" width="270" height="270" style="border-radius:12px;display:block" /></a>
                 <p style="font-size:13px;color:#666;margin:6px 0 0"><a href="${cardUrl}">Open full-size image</a></p>`
              : "";
            const ytBlock = p.to_youtube
              ? `<p style="margin:14px 0 4px"><strong>▶️ YouTube community post</strong></p><div style="background:#f4f4f5;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:15px">${esc(String(p.yt_text ?? text))}</div>`
              : "";
            const twBlock = p.to_twitter && !xPosted
              ? `<p style="margin:14px 0 4px"><strong>🐦 Twitter/X post</strong></p><div style="background:#f4f4f5;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:15px">${esc(String(p.x_text ?? String(text).slice(0, 275)))}</div>`
              : "";
            const plainBlock = (label: string, hint = "") =>
              `<p style="margin:14px 0 4px"><strong>${label}</strong>${hint ? ` <span style="color:#888;font-size:12px">${hint}</span>` : ""}</p><div style="background:#f4f4f5;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:15px">${esc(String(text))}</div>`;
            const ytvBlock = p.to_yt_video
              ? plainBlock("🎥 This week's YouTube video", "(the brief — record and publish it before the week ends)")
              : "";
            const liBlock = p.to_linkedin && !liPosted ? plainBlock("💼 LinkedIn post") : "";
            const fbBlock = p.to_facebook && !fbPosted ? plainBlock("📘 Facebook page post") : "";
            const ssBlock = p.to_substack ? plainBlock("📰 Substack", "(use as the opening — expand into a full newsletter)") : "";
            const mdBlock = p.to_medium ? plainBlock("✒️ Medium", "(use as the outline — expand into a full article)") : "";
            const rdBlock = p.to_reddit && !rdPosted ? plainBlock("👽 Reddit", "(post in r/CharteredAccountants or r/CA_India — keep it conversational, no hard selling)") : "";
            const qrBlock = p.to_quora ? plainBlock("❓ Quora", "(find related questions and answer with this — helpful tone wins on Quora)") : "";
            const gbBlock = p.to_google ? plainBlock("📍 Google Business Profile", "(post as an Update on the profile — shows in Google Search/Maps)") : "";
            const html = emailShell(`📣 Post this on ${platforms}`,
              `<p>Your campaign${p.campaign ? ` <strong>${esc(String(p.campaign))}</strong>` : ""} is going out now. Ready-to-paste content:</p>
               ${igBlock}${ytBlock}${ytvBlock}${twBlock}${liBlock}${fbBlock}${ssBlock}${mdBlock}${rdBlock}${qrBlock}${gbBlock}
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
