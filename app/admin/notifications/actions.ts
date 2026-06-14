"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import {
  sendTelegramChannel,
  sendEmail,
  emailShell,
  telegramConfigured,
  emailConfigured,
} from "@/lib/notify";
import { str } from "../_lib/util";

// Email recipients processed per click (serverless time budget). Telegram is a
// single channel post, so it always reaches everyone regardless of this cap.
const EMAIL_CAP = 500;

export async function broadcast(formData: FormData) {
  const title = str(formData.get("title"));
  const body = str(formData.get("body"));
  const link = str(formData.get("link"));
  if (!title) return;

  const chTelegram = formData.get("ch_telegram") === "on";
  const chEmail = formData.get("ch_email") === "on";

  let tgOk = false;
  let emailSent = 0;
  let emailTotal = 0;

  if (chTelegram) {
    tgOk = await sendTelegramChannel(`📢 ${title}\n\n${body}`, link || undefined);
  }

  if (chEmail && emailConfigured()) {
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

  redirect(
    `/admin/notifications?tg=${chTelegram ? (tgOk ? "ok" : "fail") : "off"}&em=${emailSent}&emt=${emailTotal}`,
  );
}
