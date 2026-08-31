import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage, notifyFaculty } from "@/lib/notify";
import { answerDoubtFromMaterial, aiConfigured, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getSecret } from "@/lib/secrets";
import { looksLikeAbuseReport, threatOfViolence, moderateMessageDyn, imageIsExplicit, containsLink, looksLikeSolicitation } from "@/lib/moderation";
import { tgDeleteMessage, tgSendGroupReply, tgApproveJoin, tgDeclineJoin, tgRestrictUser, messageHasMedia, moderatableImageId, tgGetImageB64, tgIsGroupAdmin } from "@/lib/telegramGroup";
import { discordSendToChannel } from "@/lib/discord";
import { groupAiAnswer } from "@/lib/groupDoubt";
import { answerKey, alreadyAnswered, pointerReply } from "@/lib/answeredAlready";
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
      // STAFF ARE NOT MODERATED BY THEIR OWN BOT. The exemption used to cover
      // only the link rule, so on 27 Aug the FOUNDER posted the WhatsApp
      // number for queries in his own group and the bot deleted it as "phone
      // number" — recognised him as admin, censored him anyway. A linked
      // admin, operator or faculty member is trusted with links, numbers,
      // wording and media alike; the machine polices students, not its owner.
      const mod = !isStaffSender && combined
        ? await moderateMessageDyn(combined)
        : { flagged: false, reasons: [] as string[] };
      // Students may not post links (scam/spam route); staff may.
      if (!isStaffSender && combined && containsLink(combined)) {
        mod.flagged = true;
        mod.reasons = [...mod.reasons, "link"];
      }
      // NOBODY SELLS CLASSES IN HIS GROUP — his own included. The phrase list
      // in moderateMessage only matches wording it has seen before; this asks
      // for the shape of an advert instead, so "Msg me to enroll" cannot walk
      // past it just because the list happens to say "dm me".
      const solicit = !isStaffSender && !!combined && looksLikeSolicitation(combined);
      if (solicit) {
        mod.flagged = true;
        mod.reasons = [...mod.reasons, "selling classes"];
      }

      // IMAGE / VIDEO moderation — the gap that let porn through. Any picture,
      // video, GIF or sticker is checked by AI vision; explicit content is
      // deleted AND the poster is removed on the spot (zero tolerance in a
      // students' group), and the founder is alerted.
      let mediaExplicit = false;
      let mediaReason = "";
      if (hasMedia && !isStaffSender) {
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
      //
      // A THREAT OF PHYSICAL VIOLENCE OVERRIDES ALL OF THAT. It is settled
      // first, and it switches the shield off, so that "I will beat you" can
      // never be dressed up as reporting somebody. Removing the message and
      // the sender is handled below, like an explicit image.
      const violence = !isStaffSender && combined ? threatOfViolence(combined) : { threat: false, reason: "" };
      if (violence.threat) { mod.flagged = true; mod.reasons = [...mod.reasons, violence.reason]; }

      // AND AN ADVERT IS NEVER A REPORT. The shield asks for a call for help
      // plus a third party, and an advert has both by accident: "Anyone want
      // to purchase ... of amit mahajan SIR ... contact ME at lower prices"
      // matches "sir" and "me" and would have been protected as a report.
      let isReport = !mediaExplicit && !violence.threat && !solicit
        && !!combined && looksLikeAbuseReport(combined);
      if (!isReport && mod.flagged && !mediaExplicit && !violence.threat && !solicit && fromId) {
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
      // Threatening another student is a removable offence at once.
      if (violence.threat && fromId) {
        await tgRestrictUser(chatId, fromId, true).catch(() => false);
        try {
          await svc.from("banned_group_users").upsert(
            { chat_id: chatId, user_id: null, tg_user_id: fromId, kind: "ban", reason: `Removed automatically: ${violence.reason}`, banned_by: null },
            { onConflict: "chat_id,tg_user_id" },
          );
        } catch { /* the Telegram removal already happened; the record is best-effort */ }
        try {
          await notifyFaculty(
            "🚨 A threat of violence was auto-removed from a Telegram group",
            `${fromName} (Telegram id ${fromId}) was removed from ${msg.chat.title ?? chatId} on the spot.\n\n` +
            `What they wrote:\n“${combined}”\n\n` +
            "Open /admin/discussion to review. If this was wrongly removed, lift the ban there.",
          );
        } catch { /* alert is best-effort */ }
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

      // THE WORDS, WHEREVER TELEGRAM PUT THEM.
      //
      // A message carrying a photo has no `text` at all — the words are in
      // `caption`. Every gate below read `text` only, so a student who
      // photographed the page and typed "Treatment of 3rd point
      // @caparveensharmabot" tagged the bot and got silence, in front of 1,318
      // people. The moderation code four screens up had this right already
      // (`text || caption`); the AI gate never did.
      const said = (text || caption).trim();
      const mentioned = !!botUser && said.toLowerCase().includes(`@${botUser}`);
      const repliedToBot = !!botUser && String(msg?.reply_to_message?.from?.username ?? "").toLowerCase() === botUser;

      // /courses IS NOT ANSWERED WITH A COURSE LIST. His instruction, 30 Aug.
      //
      // Students invented the command, and it was made real: it replied with
      // the three courses and a link to the fees page. That is a brochure
      // posted into a study group, and it went out twice in one night — at
      // 00:31, and again to Bhavani at 01:13 — so the room scrolled past a
      // price list to reach the teaching.
      //
      // The rule he set for course@ by email holds here too: a study channel
      // does not sell, and price and eligibility are his to state, not the
      // bot's. So /courses is deliberately NOT handled. It falls through to the
      // reply below, which tells them how to ask something that can actually be
      // answered — still threaded, so four presses in a night do not spam the
      // room.

      // /amendments — a command students type expecting the amendments position.
      // NOT a fixed script (the founder wants it worded freshly each time): it is
      // routed to the AI, which answers from his class material and the standing
      // amendments lesson (ai_lessons), threaded so repeats don't spam the room.
      if (!mod.flagged && /^\/amendments\b/i.test(said)) {
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
      const bareCmd = said.match(/^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?\s*$/i);
      const cmdForUs = bareCmd && (!bareCmd[2] || bareCmd[2].toLowerCase() === botUser);
      if (!mod.flagged && cmdForUs) {
        await tgSendGroupReply(
          chatId,
          "🤖 I don't run commands — they only fill the group. Here is how to get a real answer.\n\n" +
          "📚 On the subject — tag me" + (botUser ? ` @${botUser}` : "") + " and ask in your own words:\n" +
          "   \"Explain Ind AS 109 briefly\"   ·   \"What are the latest FR amendments?\"\n\n" +
          "📷 Stuck on a sum? Photograph the question, send the photo, and tag me in the caption — I read the picture.\n\n" +
          "🔐 Access, validity, books, an order or a payment is not for a public group. " +
          "Open caparveensharma.com/support and it reaches a person who can already see your record.",
          msg.message_id,
        );
        return NextResponse.json({ ok: true });
      }

      if (!mod.flagged && subj?.id && (mentioned || repliedToBot)) {
        try {
          // Remove the tag itself so the AI sees a clean question.
          const question = mentioned ? said.replace(new RegExp(`@${botUser}`, "ig"), " ").replace(/\s+/g, " ").trim() : said;

          // THE QUESTION IS USUALLY IN THE PICTURE.
          //
          // Students photograph the page and type three words. The portal has
          // read photographed questions since the doubt box was built, and the
          // group is where most of them are actually asked — it just never
          // passed the photo through. Now it does, and the caption is treated
          // as what it is: a pointer at the part of the page they mean.
          // ONE QUESTION, ONE ANSWER. Asked again within twelve hours, the
          // student is pointed at the answer already above rather than given a
          // second wall of text — see lib/answeredAlready.ts and the two sums
          // this group got solved twice.
          const key = answerKey(msg, question);
          const prior = await alreadyAnswered(chatId, key);
          if (prior) {
            await tgSendGroupReply(chatId, pointerReply(chatId, prior), msg.message_id);
            return NextResponse.json({ ok: true });
          }

          const photoId = moderatableImageId(msg);
          const shot = photoId ? await tgGetImageB64(photoId).catch(() => null) : null;
          const attachment = shot ? { dataB64: shot.b64, mediaType: shot.mediaType } : null;

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

          const body = await groupAiAnswer(subj.id, question, "telegram_group", attachment); // toggle+cap inside
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
                  // What this reply ANSWERED — the next identical question is
                  // pointed here instead of being solved a second time.
                  answer_key: key,
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

  // /courses in a private chat — NOT answered with a course list either, for
  // the same reason as the group and as course@ by email. It falls through to
  // the bare-command reply below, which says how to ask.

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
      "🤖 I don't run commands. Here is how to get a real answer.\n\n" +
      "📚 On the subject — just ask in your own words:\n" +
      "   \"Explain Ind AS 109 briefly\"   ·   \"What are the latest FR amendments?\"\n\n" +
      "📷 Stuck on a sum? Photograph the question and send me the picture — I read it.\n\n" +
      "🔐 Access, validity, books, an order or a payment — open caparveensharma.com/support " +
      "and it reaches a person who can already see your record.",
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
