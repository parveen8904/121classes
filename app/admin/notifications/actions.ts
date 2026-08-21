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

  // WHO GETS IT. "All students", or a segment: a course (CA Final / Inter), a
  // subject/batch (Financial Reporting, Advanced Accounting, Financial
  // Instruments — by active enrolment), or one named student by email.
  // audienceIds === null means everyone; a list means only those students.
  const audience = str(formData.get("audience")) || "all";
  const audienceEmail = str(formData.get("audience_email")).trim().toLowerCase();
  const asvc = createServiceClient();
  let audienceIds: string[] | null = null;
  if (audienceEmail) {
    const { data } = await asvc.from("profiles").select("id").eq("email", audienceEmail).maybeSingle();
    audienceIds = data?.id ? [String(data.id)] : [];
  } else if (audience.startsWith("course:")) {
    const { data: subj } = await asvc.from("subjects").select("id").eq("course_id", audience.slice(7));
    const sids = (subj ?? []).map((s) => String(s.id));
    const { data } = sids.length
      ? await asvc.from("subscriptions").select("student_id").in("subject_id", sids).eq("status", "active")
      : { data: [] as { student_id: string }[] };
    audienceIds = [...new Set((data ?? []).map((r) => String(r.student_id)).filter(Boolean))];
  } else if (audience.startsWith("subject:")) {
    const { data } = await asvc.from("subscriptions").select("student_id").eq("subject_id", audience.slice(8)).eq("status", "active");
    audienceIds = [...new Set((data ?? []).map((r) => String(r.student_id)).filter(Boolean))];
  }
  const segmented = audienceIds !== null;
  // A segment with nobody in it sends nothing, rather than silently reaching all.
  if (segmented && audienceIds!.length === 0) {
    redirect("/admin/notifications?sent=0&note=nobody-in-that-audience");
  }

  let tgOk = false;
  let dmSent = 0;
  let dmTotal = 0;
  let emailSent = 0;
  let emailTotal = 0;
  let pushSent = 0;
  let pushTotal = 0;

  // The public Telegram channel and Discord reach EVERYONE — they cannot be
  // narrowed to a segment, so they are only used for an "all students" send.
  if (chTelegram && !segmented) {
    tgOk = await sendTelegramChannel(`📢 ${title}\n\n${body}`, link || undefined);
  }

  if (chDiscord && !segmented) {
    const { postToDiscord } = await import("@/lib/discord");
    await postToDiscord(`📢 ${title}\n\n${body}`, link || undefined);
  }

  // Mass *individual* Telegram messages to students who connected the bot.
  if (chTelegramDm && (await telegramConfigured())) {
    const svc = createServiceClient();
    let q = svc
      .from("profiles")
      .select("telegram_chat_id")
      .eq("role", "student")
      .not("telegram_chat_id", "is", null);
    if (segmented) q = q.in("id", audienceIds!);
    const { data: linked } = await q.limit(TG_DM_CAP);
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
    let q = svc
      .from("profiles")
      .select("email")
      .eq("role", "student")
      .not("email", "is", null);
    if (segmented) q = q.in("id", audienceIds!);
    const { data: students } = await q.limit(EMAIL_CAP);
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
    const ready = await pushConfigured();
    if (!ready) {
      // Recorded rather than passed over in silence. A send that never happened
      // used to leave nothing behind at all, so "I sent it again and nobody got
      // it" could not be told apart from "it was sent and did not arrive".
      await createServiceClient().from("push_outbox").insert({
        kind: "general", title, body, link: link || null,
        dedupe_key: `broadcast:${Date.now()}`,
        sent_at: null, sent_count: 0,
      });
    }
    if (ready) {
      let r;
      if (segmented) {
        // Push only to the chosen students, one by one.
        const { pushToUser } = await import("@/lib/push");
        let sent = 0, failed = 0;
        for (const uid of audienceIds!) {
          const one = await pushToUser(uid, { title, body, link: link || undefined });
          sent += one.sent; failed += one.failed;
        }
        r = { sent, failed, byPlatform: null as null | { android: { sent: number; failed: number }; ios: { sent: number; failed: number } } };
      } else {
        r = await pushToEveryone({ title, body, link: link || undefined });
      }
      pushSent = r.sent;
      pushTotal = r.sent + r.failed;

      // Keep a record. A push that appeared not to arrive on an iPhone could
      // not be explained afterwards, because nothing anywhere remembered that
      // it had been sent — or that at the time there were no iPhones to send
      // to. A row here makes the question answerable next time.
      const p = r.byPlatform;
      await createServiceClient().from("push_outbox").insert({
        kind: "general",
        // The platform split rides in the title of the record, because that is
        // what gets read when somebody says it did not arrive on iPhones.
        //
        // SPELLED OUT, because "[android 17/19]" was read as "17 of 19 students
        // saw it". It is neither students nor views: it is DEVICES that
        // registered for notifications, and how many Google and Apple accepted
        // the message for. A device fails when the app was uninstalled or the
        // token expired — which is worth seeing, and is not a reader who
        // ignored you. Nothing anywhere tells us who opened a notification.
        title: p
          ? `${title}  — delivered to ${p.android.sent}/${p.android.sent + p.android.failed} Android and ` +
            `${p.ios.sent}/${p.ios.sent + p.ios.failed} iPhone device(s)`
          : title,
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
