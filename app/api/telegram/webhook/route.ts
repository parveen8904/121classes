import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage, notifyFaculty } from "@/lib/notify";
import { answerDoubtFromMaterial, aiConfigured, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getSecret } from "@/lib/secrets";
import { looksLikeAbuseReport, moderateMessageDyn, imageIsExplicit, containsLink } from "@/lib/moderation";
import { tgDeleteMessage, tgSendGroupReply, tgApproveJoin, tgDeclineJoin, tgRestrictUser, messageHasMedia, moderatableImageId, tgGetImageB64, tgIsGroupAdmin } from "@/lib/telegramGroup";
import { discordSendToChannel } from "@/lib/discord";
import { groupAiAnswer } from "@/lib/groupDoubt";
import { judgeStudentMessage } from "@/lib/ai";
import { handleAbuse } from "@/lib/abuseEscalation";

export const dynamic = "force-dynamic";

// THE /amendments ANSWER IS NOT A SCRIPT.
//
// The founder wants it worded freshly each time, not a fixed paragraph — but
// grounded in the facts he approved. Those facts live as a standing correction
// in ai_lessons ("no new amendment notified; GSR 549(E) → Ind AS 21 Lack of
// Exchangeability + current/non-current, all covered; Ind AS 118 upcoming"),
// so the AI weaves them into a natural reply on every channel. The command just
// asks the AI this question. The fallback is used only if the AI is switched
// off or over its daily cap — a one-liner, never a substitute for the answer.
const AMENDMENTS_Q =
  "What are the latest amendments applicable for CA Final Financial Reporting, and are they already covered in the classes and study material?";
const AMENDMENTS_FALLBACK =
  "📝 For your attempt, the latest applicable amendments are listed here: caparveensharma.com/amendments — and they are covered in your classes. Ask me in your own words if you want the detail.";

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
    // EVERYONE IS LET IN. His instruction, 26 Aug 2026: "there is no need to
    // check the student whether they exist in our system or not, if they are
    // asking proper things, let them be in the group. We want to increase the
    // group size. We don't want to decrease the group size."
    //
    // The old rule declined anyone who had not pressed "Connect Telegram" on
    // their dashboard — 9.5% of students — and told them so in a DM Telegram
    // would not deliver, because a bot cannot message someone who has never
    // opened a chat with it. So it turned away his own paying students in
    // silence, and the CA Intermediate group emptied.
    //
    // Behaviour, not membership, is what is policed now: blocked terms, links,
    // explicit images and abuse are all still enforced below, and anyone who
    // abuses the room is removed by the rule right under this one.
    await tgApproveJoin(jrChat, jrUser);
    if (!linked?.id) {
      // Best-effort and entirely optional — linking makes the portal recognise
      // them, it is not a condition of being here. Fails silently when they
      // have never started the bot, which is fine; they are already in.
      await sendTelegramMessage(
        jrUser,
        "👋 Welcome to CA Parveen Sharma's study group.\n\n" +
        "Tip: sign in at caparveensharma.com and tap “Connect Telegram” on your dashboard — then the assistant here can see your course and answer from your own material.",
      ).catch(() => false);
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
    const caption = String(msg?.caption ?? "").trim();
    const hasMedia = messageHasMedia(msg);
    if (msg?.message_id && (text || caption || hasMedia)) {
      const { data: subj } = await svc.from("subjects").select("id, discord_channel_id").eq("telegram_group_chat_id", chatId).maybeSingle();
      const fromId = msg?.from?.id ? String(msg.from.id) : null;
      const fromName = [msg?.from?.first_name, msg?.from?.last_name].filter(Boolean).join(" ") || msg?.from?.username || "Member";

      // STUDENTS ONLY — the real lock. The join gate approves only linked
      // students, but if anyone slips in (an old public invite link, added
      // before the gate), their FIRST message removes them: a sender whose
      // Telegram id is not a linked portal account is deleted and banned on the
      // spot. Linked staff (admin/faculty/operator) are exempt.
      const senderProf = fromId && !msg?.from?.is_bot
        ? (await svc.from("profiles").select("id, role").eq("telegram_chat_id", fromId).maybeSingle()).data
        : null;
      //
      // 26 Aug 2026 — THIS RULE WAS EATING HIS OWN STUDENTS.
      //
      // It banned on the FIRST message, and "linked" means the student pressed
      // "Connect Telegram" on their dashboard. Only 373 of 3,910 students ever
      // did (9.5%), so the test called nine students in ten an intruder. 36
      // people were removed from the two groups, at least two of them holding
      // a live paid subscription, and CA Intermediate went from 68 messages a
      // day to nothing from 21 August. The founder's question was why the
      // group had gone quiet: it had been quietly emptied.
      //
      // The explanation never reached them either. It was sent as a DM, and
      // Telegram refuses a bot's DM to anyone who has not first opened a chat
      // with that bot — which someone who never linked has by definition not
      // done. So they were removed in silence, with no idea why.
      //
      // The door is the JOIN GATE above, which approves only linked students
      // and is the right place for it. Somebody already inside and talking is
      // overwhelmingly a paying student who simply never did a second setup
      // step, so they are ASKED, in the room where they can actually read it,
      // and their message stands. Blocked terms, links and abuse are still
      // policed below exactly as before.
      // NOTHING HERE CHECKS WHETHER THE SENDER IS "OURS" ANY MORE.
      //
      // This is where his own students were being deleted and banned on their
      // first message for not having linked a Telegram account — 36 of them,
      // two with live paid subscriptions. His ruling: do not check whether a
      // student exists in our system; if they are asking proper things, let
      // them be in the group. What follows polices what people DO, which is
      // the thing that actually matters.
      const isStaffSender = !!senderProf && senderProf.role !== "student";

      // TEXT / CAPTION moderation (blocked terms, spam, links) — now also
      // covering a photo's caption. Students may not post links; staff may.
      const combined = (text || caption).trim();
      const mod = combined ? await moderateMessageDyn(combined) : { flagged: false, reasons: [] as string[] };
      // Students may not post links (scam/spam route); staff may.
      if (!isStaffSender && combined && containsLink(combined)) {
        mod.flagged = true;
        mod.reasons = [...mod.reasons, "link"];
      }

      // IMAGE / VIDEO moderation — the gap that let porn through. Any picture,
      // video, GIF or sticker is checked by AI vision; explicit content is
      // deleted AND the poster is removed on the spot (zero tolerance in a
      // students' group), and the founder is alerted.
      let mediaExplicit = false;
      let mediaReason = "";
      if (hasMedia) {
        const fileId = moderatableImageId(msg);
        if (fileId) {
          const img = await tgGetImageB64(fileId);
          if (img) {
            const verdict = await imageIsExplicit(img.b64, img.mediaType);
            if (verdict.explicit) { mediaExplicit = true; mediaReason = verdict.reason || "explicit image"; }
          }
        }
      }

      // A REPORT OF ABUSE IS NEVER HIDDEN, AND NEVER DELETED.
      //
      // On 21 August the blocked-terms list matched the words a student needed
      // to describe what was being done to her, and nine of her ten messages
      // were removed from the room while the account she named kept posting.
      // His ruling: the person reporting abuse must not be blocked, the person
      // abusing must be. So a flagged message that reads as a REPORT stays up
      // and comes to him instead.
      //
      // A report arrives in pieces — "Sending inappropriate msg", then "And
      // sexting" — and the later pieces carry no report words of their own. So
      // once somebody has reported, anything else they say for the next
      // fifteen minutes is treated as part of it.
      let isReport = !mediaExplicit && !!combined && looksLikeAbuseReport(combined);
      if (!isReport && mod.flagged && !mediaExplicit && fromId) {
        const { data: recent } = await svc
          .from("group_messages")
          .select("body")
          .eq("chat_id", chatId)
          .eq("sender_tg_id", fromId)
          .gte("created_at", new Date(Date.now() - 15 * 60e3).toISOString())
          .order("created_at", { ascending: false })
          .limit(10);
        isReport = (recent ?? []).some((r) => looksLikeAbuseReport(String((r as { body: string }).body ?? "")));
      }

      let status = "visible";
      if ((mod.flagged || mediaExplicit) && !isReport) {
        await tgDeleteMessage(chatId, msg.message_id); // bot must be group admin
        status = "hidden";
      }
      if (isReport && mod.flagged) {
        // Straight to him, with everything he needs to act on it.
        try {
          const { notifyFaculty } = await import("@/lib/notify");
          await notifyFaculty(
            "🚨 A student is reporting abuse in a study group",
            `${fromName} (Telegram id ${fromId ?? "unknown"}) in ${msg.chat.title ?? chatId}:\n\n` +
            `“${combined}”\n\n` +
            "Their message has been LEFT VISIBLE deliberately. Open /admin/discussion to see the thread and remove whoever they are naming.",
          );
        } catch { /* an alert that fails must not hide the message */ }
        try {
          await svc.from("message_moderation_log").insert({
            message_id: null, action: "abuse_report_kept_visible", reason: mod.reasons.join(", ") || "report",
          });
        } catch { /* logging is best effort */ }
      }
      // Explicit media is a removable offence at once — not a warning.
      if (mediaExplicit && fromId) {
        await tgRestrictUser(chatId, fromId, true).catch(() => false);
        try {
          await svc.from("banned_group_users").upsert(
            { chat_id: chatId, user_id: null, tg_user_id: fromId, kind: "ban", reason: `Removed automatically: explicit image (${mediaReason})`, banned_by: null },
            { onConflict: "chat_id,tg_user_id" },
          );
        } catch { /* the Telegram removal already happened; the record is best-effort */ }
        try {
          await notifyFaculty(
            "🚫 Explicit image auto-removed from a Telegram group",
            `The poster (${fromName}) was removed on the spot.\nReason: ${mediaReason}\nGroup chat: ${chatId}`,
          );
        } catch { /* alert is best-effort */ }
      }
      if (mediaExplicit) { mod.flagged = true; mod.reasons = [...mod.reasons, `explicit_media:${mediaReason}`]; }
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
            body: text || caption || (hasMedia ? "[media]" : ""),
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

      // ---- "my paper has not been checked" — answered WITHOUT being asked ----
      //
      // The one thing the bot says unprompted, because this complaint is public,
      // it is about money already paid, and forty other students read it before
      // anybody answers. The route that works takes ten seconds to give.
      if (!mod.flagged) {
        try {
          const { isEvaluationComplaint, EVALUATION_HELP } = await import("@/lib/evaluationHelp");
          if (isEvaluationComplaint(text)) {
            const sentId = await tgSendGroupReply(chatId, EVALUATION_HELP, msg.message_id);
            if (sentId && subj?.id) {
              await svc.from("group_messages").upsert(
                {
                  chat_id: chatId,
                  subject_id: subj.id,
                  tg_message_id: sentId,
                  source: "telegram",
                  sender_tg_id: null,
                  sender_name: "🤖 AI assistant",
                  body: EVALUATION_HELP,
                  reply_to_tg_id: msg.message_id,
                  flagged: false,
                  flag_reasons: [],
                  status: "visible",
                },
                { onConflict: "chat_id,tg_message_id" },
              );
            }
            return NextResponse.json({ ok: true });
          }
        } catch { /* never let this stop the mirror */ }
      }

      // ---- AI answers in the group: ONLY when the bot is asked directly ----
      // The bot never interrupts a student-to-student discussion. It answers
      // only when a student TAGS it (@botname …) or REPLIES to one of its
      // messages. The answer is threaded, marked 🤖, mirrored to Discord and
      // stored for the website view. Controls: 'group_doubt' toggle + daily cap.
      const botUser = ((await getSecret("TELEGRAM_BOT_USERNAME")) || "").replace(/^@/, "").toLowerCase();
      const mentioned = !!botUser && text.toLowerCase().includes(`@${botUser}`);
      const repliedToBot = !!botUser && String(msg?.reply_to_message?.from?.username ?? "").toLowerCase() === botUser;

      // /courses — THE COMMAND THE STUDENTS INVENTED.
      //
      // Nobody built it and nothing registered it. One student typed
      // "/courses@caparveensharmabot" in the Financial Reporting group hoping
      // for a course list, got silence, and others copied — four of them inside
      // twelve hours, and then the founder himself, also to silence. The
      // mention detector saw the @botname, handed "/courses" to the AI judge,
      // which found no question in it and said nothing. A command that LOOKS
      // like a feature and answers nothing reads as a broken bot to the whole
      // room.
      //
      // So it is a feature now. Answered directly, before the AI, with the two
      // places courses actually live — and threaded to the asker so the group
      // is not spammed when four people press it in a night.
      if (!mod.flagged && /^\/courses\b/i.test(text.trim())) {
        await tgSendGroupReply(
          chatId,
          "📚 CA Parveen Sharma's courses:\n\n" +
          "• CA Final — Financial Reporting\n" +
          "• CA Inter — Advanced Accounting\n" +
          "• Financial Instruments — Live Batch\n\n" +
          "Details, demos and fees: caparveensharma.com/courses\n" +
          "Your own classes after buying: caparveensharma.com/dashboard",
          msg.message_id,
        );
        return NextResponse.json({ ok: true });
      }

      // /amendments — a command students type expecting the amendments position.
      // NOT a fixed script (the founder wants it worded freshly each time): it is
      // routed to the AI, which answers from his class material and the standing
      // amendments lesson (ai_lessons), threaded so repeats don't spam the room.
      if (!mod.flagged && /^\/amendments\b/i.test(text.trim())) {
        const body = subj?.id ? await groupAiAnswer(subj.id, AMENDMENTS_Q) : null;
        await tgSendGroupReply(chatId, body || AMENDMENTS_FALLBACK, msg.message_id);
        return NextResponse.json({ ok: true });
      }

      // ANY OTHER SLASH-COMMAND STUDENTS INVENT. A bare "/something@botname" we
      // don't handle used to fall through to the AI judge, which found no
      // question and said nothing — so students posted it again and again into
      // the silence. Now a bare command aimed at us (or with no bot named) that
      // we don't recognise gets ONE short, threaded reply telling them what IS
      // here, so the void stops inviting repeats.
      const bareCmd = text.trim().match(/^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?\s*$/i);
      const cmdForUs = bareCmd && (!bareCmd[2] || bareCmd[2].toLowerCase() === botUser);
      if (!mod.flagged && cmdForUs) {
        await tgSendGroupReply(
          chatId,
          "🤖 Please don't type commands like this — I don't run them, so they just fill the group.\n\n" +
          "Instead, tell me clearly in your own words what you need" +
          (botUser ? ` (tag me @${botUser})` : "") +
          " — for example: \"What are the latest FR amendments?\" or \"Explain Ind AS 109 briefly.\" — and I'll answer.",
          msg.message_id,
        );
        return NextResponse.json({ ok: true });
      }

      if (!mod.flagged && subj?.id && (mentioned || repliedToBot)) {
        try {
          // Remove the tag itself so the AI sees a clean question.
          const question = mentioned ? text.replace(new RegExp(`@${botUser}`, "ig"), " ").replace(/\s+/g, " ").trim() : text;

          // Abuse is dealt with before anything else: warned once, removed the
          // second time. Tagging the bot with abuse is still abuse.
          const judged = await judgeStudentMessage(question);
          if (judged.kind === "abusive") {
            const r = await handleAbuse({
              chatId,
              tgUserId: msg?.from?.id ? String(msg.from.id) : null,
              text: question,
              senderName: fromName,
            });
            await tgSendGroupReply(chatId, r.reply, msg.message_id);
            return NextResponse.json({ ok: true });
          }

          const body = await groupAiAnswer(subj.id, question); // toggle+cap inside
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

  // Remember every private chat that ever talks to the bot — Telegram only
  // lets bots DM people who started them, so this table IS the direct-message
  // audience (portal students and group members alike).
  try {
    await svc.from("telegram_subscribers").upsert(
      { chat_id: chatId, first_name: msg?.from?.first_name ?? null },
      { onConflict: "chat_id" },
    );
  } catch { /* best-effort */ }

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

  // /courses in a private chat — same answer as in the groups, same reason.
  if (/^\/courses\b/i.test(text.trim())) {
    await sendTelegramMessage(
      chatId,
      "📚 CA Parveen Sharma's courses:\n\n" +
      "• CA Final — Financial Reporting\n" +
      "• CA Inter — Advanced Accounting\n" +
      "• Financial Instruments — Live Batch\n\n" +
      "Details, demos and fees: caparveensharma.com/courses\n" +
      "Your own classes after buying: caparveensharma.com/dashboard",
    );
    return NextResponse.json({ ok: true });
  }

  // /amendments in a private chat — routed to the AI (fresh wording each time),
  // grounded in the class material and the standing amendments lesson.
  if (/^\/amendments\b/i.test(text.trim())) {
    let ans: string | null = null;
    if (await aiConfigured()) {
      const material = await getRepositoryContext(null, 12000, { query: AMENDMENTS_Q });
      const raw = await answerDoubtFromMaterial(AMENDMENTS_Q, material, "doubt", {});
      if (raw && raw.trim() !== NEED_FACULTY) ans = raw;
    }
    await sendTelegramMessage(chatId, ans || AMENDMENTS_FALLBACK);
    return NextResponse.json({ ok: true });
  }

  // Any OTHER bare slash-command in a private chat — don't leave it silent, or
  // the student keeps trying. One short reply pointing at what actually works.
  if (/^\/[a-z0-9_]+(@[a-z0-9_]+)?\s*$/i.test(text.trim())) {
    await sendTelegramMessage(
      chatId,
      "🤖 Please don't type commands like this — I don't run them.\n\n" +
      "Just tell me clearly, in your own words, what you need — for example: \"What are the latest FR amendments?\" or \"Explain Ind AS 109 briefly.\" — and I'll answer.",
    );
    return NextResponse.json({ ok: true });
  }

  // The same answer in a private chat. A student who writes "my copy is still
  // not checked" to the bot needs the route, not a general study answer.
  try {
    const { isEvaluationComplaint, EVALUATION_HELP } = await import("@/lib/evaluationHelp");
    if (isEvaluationComplaint(text)) {
      await sendTelegramMessage(chatId, EVALUATION_HELP);
      return NextResponse.json({ ok: true });
    }
  } catch { /* fall through to the normal doubt path */ }

  // 2) Treat as a doubt.
  const who = await svc
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  // Optional gate: only answer doubts from connected (linked) students. When on,
  // an unlinked chatter is asked to connect first — making joining worthwhile.
  // READ THE TOGGLE FROM WHERE THE ADMIN SCREEN WRITES IT.
  //
  // /admin/telegram saves this into site_settings; this line asked getSecret,
  // which reads app_secrets and then the environment. Two different tables. So
  // the switch has never done anything — it reads as off however it is set, and
  // the screen shows it on. Whatever the setting is meant to be, it should at
  // least be the setting that is obeyed.
  const connectedOnly = await svc
    .from("site_settings").select("value").eq("key", "telegram_connected_only").maybeSingle()
    .then((r) => String((r.data as { value?: string } | null)?.value ?? "") === "1", () => false);

  if (!who.data?.id && connectedOnly) {
    await sendTelegramMessage(
      chatId,
      "🔒 Please connect your CA Parveen Sharma account first — tap “Connect Telegram” on your dashboard. Once connected, I'll answer your doubts right here.",
    );
    return NextResponse.json({ ok: true });
  }

  // Distress first, always.
  const { checkDistress, raiseDistress, DISTRESS_REPLY } = await import("@/lib/distress");
  const distress = await checkDistress(text).catch(() => null);
  if (distress?.distressed) {
    await sendTelegramMessage(chatId, DISTRESS_REPLY);
    await raiseDistress({ channel: "telegram", question: text, who: String(chatId), severe: distress.severe });
    return;
  }

  let answer: string | null = null;
  // Read once, out here, because the closing note needs the same thread the
  // answer was written from. Named for what it is: TypeScript already has a
  // History in scope, and shadowing it silently handed the wrong value along.
  let thread = "";
  if (await aiConfigured()) {
    let material = await getRepositoryContext(null, 12000, { query: text });
    const ctx = await import("@/lib/studentContext");
    if (ctx.isAccountQuestion(text)) {
      const facts = await ctx.studentFactsByTelegram(String(chatId)).catch(() => null);
      if (facts) material = `${ctx.accountAnswerRules(facts)}\n\n---\n\n${material}`;
    }
    const { loggedHistory } = await import("@/lib/conversation");
    thread = await loggedHistory({ channel: "telegram", telegramChatId: String(chatId), current: text }).catch(() => "");
    const raw = await answerDoubtFromMaterial(text, material, "doubt", { history: thread });
    if (raw && raw.trim() !== NEED_FACULTY) answer = raw;
  }
  if (answer) {
    await sendTelegramMessage(chatId, answer + "\n\n— CA Parveen Sharma");
    try {
      const { maybeClosingNote } = await import("@/lib/conversationClose");
      const note = await maybeClosingNote({
        who: String(chatId), channel: "telegram", history: thread, latest: text,
      });
      if (note) await sendTelegramMessage(chatId, note);
    } catch { /* the answer already went */ }
  } else {
    // Not "faculty will reply soon" and then nothing. A reply built from what
    // the site actually has goes now; a person can still add to it.
    const { replyFromSiteMap, PLAIN_FALLBACK } = await import("@/lib/ai");
    const stopgap = (await replyFromSiteMap(text).catch(() => null)) ?? PLAIN_FALLBACK;
    await sendTelegramMessage(chatId, stopgap + "\n\n— CA Parveen Sharma");
    await notifyFaculty(
      "A student doubt needs your reply (Telegram)",
      `Question:\n${text}\n\nWhat already went to the student:\n${stopgap}\n\nAdd to it from Admin → Inbox.`,
    );
  }

  // Log it so faculty can see (and the student can follow up in their inbox).
  // The answer is recorded whether or not the asker is a linked student —
  // previously an unlinked chat's answer vanished, and those are exactly the
  // people whose answers nobody was checking.
  const { logAiExchange } = await import("@/lib/aiAnswerLog");
  await logAiExchange({
    channel: "telegram",
    question: text,
    answer,
    userId: who.data?.id ?? null,
    telegramChatId: chatId,
  });

  return NextResponse.json({ ok: true });
}
