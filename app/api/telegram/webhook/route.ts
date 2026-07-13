import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage, notifyFaculty } from "@/lib/notify";
import { answerDoubtFromMaterial, aiConfigured, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getSecret } from "@/lib/secrets";
import { moderateMessageDyn } from "@/lib/moderation";
import { tgDeleteMessage, tgSendGroupReply, tgApproveJoin, tgDeclineJoin } from "@/lib/telegramGroup";
import { discordSendToChannel } from "@/lib/discord";
import { groupAiAnswer } from "@/lib/groupDoubt";

export const dynamic = "force-dynamic";

// Telegram calls this when a student messages the bot. Two jobs:
//  1) /start <code>  → link the student's account to their Telegram chat id
//  2) any other text → answer the doubt (AI, repository-grounded later); if AI
//     can't help, tell them it's gone to faculty and store it for review.
export async function POST(req: NextRequest) {
  // Optional shared-secret check (set TELEGRAM_WEBHOOK_SECRET + pass it to setWebhook).
  const secret = await getSecret("TELEGRAM_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const svc = createServiceClient();

  // Bot added to / present in a group → capture the group's chat id so the admin
  // can link it to a subject and auto-post there. (allowed_updates includes my_chat_member.)
  const cm = update?.my_chat_member;
  if (cm?.chat?.id && (cm.chat.type === "group" || cm.chat.type === "supergroup")) {
    const status = cm?.new_chat_member?.status;
    if (status === "member" || status === "administrator") {
      await svc.from("telegram_groups").upsert(
        { chat_id: String(cm.chat.id), title: cm.chat.title ?? "Group", last_seen_at: new Date().toISOString() },
        { onConflict: "chat_id" },
      );
    } else if (status === "left" || status === "kicked") {
      await svc.from("telegram_groups").delete().eq("chat_id", String(cm.chat.id));
    }
    return NextResponse.json({ ok: true });
  }

  // ---- Members-only gate: someone asked to JOIN a subject group ----
  // The group has "Approve new members" on; Telegram sends us the request. We
  // approve ONLY people who have linked their portal account (Connect Telegram
  // on the dashboard) — everyone else is declined with a DM explaining how.
  const jr = update?.chat_join_request;
  if (jr?.chat?.id && jr?.from?.id) {
    const jrChat = String(jr.chat.id);
    const jrUser = String(jr.from.id);
    // For 1-to-1 chats the chat id IS the user id, so profiles.telegram_chat_id
    // (set during Connect Telegram) doubles as the linked Telegram user id.
    const { data: linked } = await svc
      .from("profiles")
      .select("id")
      .eq("telegram_chat_id", jrUser)
      .maybeSingle();
    if (linked?.id) {
      await tgApproveJoin(jrChat, jrUser);
    } else {
      await tgDeclineJoin(jrChat, jrUser);
      // Best-effort DM (works only if they've ever started the bot).
      await sendTelegramMessage(
        jrUser,
        "🔒 This group is only for CA Parveen Sharma students. Please log in at caparveensharma.com, tap “Connect Telegram” on your dashboard, then request to join again — you'll be approved automatically.",
      );
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message ?? update?.edited_message;
  const chatId: string | undefined = msg?.chat?.id ? String(msg.chat.id) : undefined;
  const text: string = (msg?.text ?? "").trim();
  // ---- GROUP messages: mirror into our DB (source of truth) + auto-moderate ----
  if (chatId && (msg?.chat?.type === "group" || msg?.chat?.type === "supergroup")) {
    await svc.from("telegram_groups").upsert(
      { chat_id: chatId, title: msg.chat.title ?? "Group", last_seen_at: new Date().toISOString() },
      { onConflict: "chat_id" },
    );
    if (msg?.message_id && text) {
      const { data: subj } = await svc.from("subjects").select("id, discord_channel_id").eq("telegram_group_chat_id", chatId).maybeSingle();
      const fromId = msg?.from?.id ? String(msg.from.id) : null;
      const fromName = [msg?.from?.first_name, msg?.from?.last_name].filter(Boolean).join(" ") || msg?.from?.username || "Member";
      const mod = await moderateMessageDyn(text);
      let status = "visible";
      if (mod.flagged) {
        await tgDeleteMessage(chatId, msg.message_id); // bot must be group admin
        status = "hidden";
      }
      const { data: gm } = await svc
        .from("group_messages")
        .upsert(
          {
            chat_id: chatId,
            subject_id: subj?.id ?? null,
            tg_message_id: msg.message_id,
            source: "telegram",
            sender_tg_id: fromId,
            sender_name: fromName,
            body: text,
            reply_to_tg_id: msg?.reply_to_message?.message_id ?? null,
            flagged: mod.flagged,
            flag_reasons: mod.reasons,
            status,
          },
          { onConflict: "chat_id,tg_message_id" },
        )
        .select("id")
        .maybeSingle();
      if (mod.flagged && gm?.id) {
        await svc.from("message_moderation_log").insert({ message_id: gm.id, action: "auto_hidden", reason: mod.reasons.join(", ") });
      }
      // Bridge to Discord (clean messages only) — bot-authored, so no echo loop.
      const dc = (subj as { discord_channel_id?: string | null } | null)?.discord_channel_id;
      if (!mod.flagged && dc) {
        await discordSendToChannel(dc, `👤 ${fromName}: ${text}`);
      }

      // ---- AI answers in the group ----
      // A clean message that reads like an academic question gets an instant AI
      // reply, grounded in THIS subject's material, threaded under the question
      // and clearly marked 🤖. Mirrored to Discord + stored so the website
      // discussion shows it too. Off-syllabus / unknown → stay SILENT (no group
      // noise; faculty can reply from the moderation panel like before).
      // Controls: the "group_doubt" admin toggle + a daily cap (default 100/day).
      if (!mod.flagged && subj?.id) {
        try {
          const body = await groupAiAnswer(subj.id, text); // toggle+cap+question check inside
          if (body) {
            const sentId = await tgSendGroupReply(chatId, body, msg.message_id);
            if (sentId) {
              // Store the bot's own reply (Telegram never webhooks it back to us)
              // so the website discussion and moderation panel show the thread.
              await svc.from("group_messages").upsert(
                {
                  chat_id: chatId,
                  subject_id: subj.id,
                  tg_message_id: sentId,
                  source: "telegram",
                  sender_tg_id: null,
                  sender_name: "🤖 AI assistant",
                  body,
                  reply_to_tg_id: msg.message_id,
                  flagged: false,
                  flag_reasons: [],
                  status: "visible",
                },
                { onConflict: "chat_id,tg_message_id" },
              );
              if (dc) await discordSendToChannel(dc, body);
            }
          }
        } catch { /* never block the mirror on an AI hiccup */ }
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (!chatId || !text) return NextResponse.json({ ok: true });

  // 1) Account linking via deep link: /start <code>
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (code) {
      const { data: prof } = await svc
        .from("profiles")
        .select("id, full_name")
        .eq("telegram_link_code", code)
        .maybeSingle();
      if (prof) {
        await svc.from("profiles").update({ telegram_chat_id: chatId }).eq("id", prof.id);
        await sendTelegramMessage(
          chatId,
          `✅ Connected! Hi ${prof.full_name || "there"} — you'll now get updates here, and you can ask me any doubt anytime.`,
        );
        return NextResponse.json({ ok: true });
      }
    }
    await sendTelegramMessage(
      chatId,
      "👋 Welcome to CA Parveen Sharma! To connect your account, open the “Connect Telegram” button on your dashboard. You can also just type any doubt and I'll help.",
    );
    return NextResponse.json({ ok: true });
  }

  // 2) Treat as a doubt.
  const who = await svc
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  // Optional gate: only answer doubts from connected (linked) students. When on,
  // an unlinked chatter is asked to connect first — making joining worthwhile.
  if (!who.data?.id && (await getSecret("telegram_connected_only")) === "1") {
    await sendTelegramMessage(
      chatId,
      "🔒 Please connect your CA Parveen Sharma account first — tap “Connect Telegram” on your dashboard. Once connected, I'll answer your doubts right here.",
    );
    return NextResponse.json({ ok: true });
  }

  let answer: string | null = null;
  if (await aiConfigured()) {
    const material = await getRepositoryContext(null, 12000, { query: text });
    const raw = await answerDoubtFromMaterial(text, material);
    if (raw && raw.trim() !== NEED_FACULTY) answer = raw;
  }
  if (answer) {
    await sendTelegramMessage(chatId, answer + "\n\n— CA Parveen Sharma");
  } else {
    await sendTelegramMessage(
      chatId,
      "✅ Got your doubt! Our faculty will review it and reply here soon.",
    );
    await notifyFaculty(
      "A student doubt needs your reply (Telegram)",
      `Question:\n${text}\n\nReply from Admin → Inbox.`,
    );
  }

  // Log it so faculty can see (and the student can follow up in their inbox).
  try {
    const { data: ins } = await svc
      .from("page_questions")
      .insert({
        user_id: who.data?.id ?? null,
        page_path: "telegram",
        question: text,
        status: answer ? "answered" : "open",
        telegram_chat_id: chatId,
      })
      .select("id")
      .single();
    if (answer && who.data?.id && ins?.id) {
      await svc.from("page_questions").insert({
        user_id: who.data.id,
        question: answer,
        page_path: `reply:${ins.id}`,
        status: "reply",
      });
    }
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true });
}
