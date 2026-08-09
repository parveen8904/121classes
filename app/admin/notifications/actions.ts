"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import {
  sendTelegramChannel,
  sendTelegramMessage,
  sendEmail,
  emailShell,
  telegramConfigured,
  emailConfigured,
} from "@/lib/notify";
import { str } from "../_lib/util";
import { assertArea } from "@/lib/adminAccess";

// Recipients processed per click (serverless time budget). The Telegram CHANNEL
// post is a single call and always reaches everyone regardless of this cap.
const EMAIL_CAP = 500;
const TG_DM_CAP = 1000;

export async function broadcast(formData: FormData) {
  await assertArea("announcements");
  const title = str(formData.get("title"));
  const body = str(formData.get("body"));
  const link = str(formData.get("link"));
  if (!title) return;

  const chTelegram = formData.get("ch_telegram") === "on";
  const chDiscord = formData.get("ch_discord") === "on";
  const chTelegramDm = formData.get("ch_telegram_dm") === "on";
  const chEmail = formData.get("ch_email") === "on";
  const chPush = formData.get("ch_push") === "on";

  let tgOk = false;
  let dmSent = 0;
  let dmTotal = 0;
  let emailSent = 0;
  let emailTotal = 0;
  let pushSent = 0;
  let pushTotal = 0;

  if (chTelegram) {
    tgOk = await sendTelegramChannel(`📢 ${title}\n\n${body}`, link || undefined);
  }

  // Post to the Discord server channel too (parity with Telegram).
  if (chDiscord) {
    const { postToDiscord } = await import("@/lib/discord");
    await postToDiscord(`📢 ${title}\n\n${body}`, link || undefined);
  }

  // Mass *individual* Telegram messages to students who connected the bot.
  if (chTelegramDm && (await telegramConfigured())) {
    const svc = createServiceClient();
    const { data: linked } = await svc
      .from("profiles")
      .select("telegram_chat_id")
      .eq("role", "student")
      .not("telegram_chat_id", "is", null)
      .limit(TG_DM_CAP);
    const ids = (linked ?? []).map((s) => s.telegram_chat_id as string).filter(Boolean);
    dmTotal = ids.length;
    const text = `📢 ${title}\n\n${body}`;
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const results = await Promise.allSettled(chunk.map((id) => sendTelegramMessage(id, text, link || undefined)));
      dmSent += results.filter((r) => r.status === "fulfilled" && r.value).length;
    }
  }

  if (chEmail && (await emailConfigured())) {
    const svc = createServiceClient();
    const { data: students } = await svc
      .from("profiles")
      .select("email")
      .eq("role", "student")
      .not("email", "is", null)
      .limit(EMAIL_CAP);
    const list = (students ?? []).map((s) => s.email as string).filter(Boolean);
    emailTotal = list.length;
    const html = emailShell(
      title,
      `<p>${body.replace(/\n/g, "<br/>")}</p>${link ? `<p><a href="${link}">${link}</a></p>` : ""}`,
    );
    for (let i = 0; i < list.length; i += 25) {
      const chunk = list.slice(i, i + 25);
      const results = await Promise.allSettled(chunk.map((to) => sendEmail(to, title, html)));
      emailSent += results.filter((r) => r.status === "fulfilled" && r.value).length;
    }
  }

  // The apps. Reaches the phone in the student's hand within seconds, and is
  // the only channel here that arrives without them opening anything.
  if (chPush) {
    const { pushToEveryone, pushConfigured } = await import("@/lib/push");
    if (await pushConfigured()) {
      const r = await pushToEveryone({ title, body, link: link || undefined });
      pushSent = r.sent;
      pushTotal = r.sent + r.failed;

      // Keep a record. A push that appeared not to arrive on an iPhone could
      // not be explained afterwards, because nothing anywhere remembered that
      // it had been sent — or that at the time there were no iPhones to send
      // to. A row here makes the question answerable next time.
      await createServiceClient().from("push_outbox").insert({
        kind: "general",
        title,
        body,
        link: link || null,
        dedupe_key: `broadcast:${Date.now()}`,
        sent_at: new Date().toISOString(),
        sent_count: r.sent,
      });
    }
  }

  redirect(
    `/admin/notifications?ps=${pushSent}&pst=${pushTotal}&tg=${chTelegram ? (tgOk ? "ok" : "fail") : "off"}&em=${emailSent}&emt=${emailTotal}&dm=${dmSent}&dmt=${dmTotal}`,
  );
}
