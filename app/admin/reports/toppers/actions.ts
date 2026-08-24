"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { istDay, recordToppers, toppersMessage } from "@/lib/dailyToppers";

// SEND THE DAY'S TOPPERS NOW, BY HAND.
//
// The nightly pair does this on its own — decided at 11:59 PM, announced at
// 3 AM — but announcing needed CRON_SECRET to trigger, which is not something
// to be handing round to see whether it works. This is the same code behind a
// button he can press, and it is also the way to re-send a day the cron missed.
//
// PREVIEW FIRST, THEN SEND. `announceTodayToppers` shows the exact message and
// posts nothing; `sendToppersNow` is the one that goes out to the channel, the
// groups, Discord and every phone.

async function build(day: string) {
  const rows = await recordToppers(day);
  return { rows, text: rows.length ? toppersMessage(rows, day) : "" };
}

/** Work out the message for a day and show it. Sends nothing. */
export async function previewToppers(formData: FormData) {
  if (!(await requireArea("reports"))) return;
  const day = String(formData.get("day") ?? "") || istDay();
  const { rows, text } = await build(day);
  revalidatePath("/admin/reports/toppers");
  redirect(`/admin/reports/toppers?day=${day}&preview=${encodeURIComponent(
    rows.length ? text : `No copies were released on ${day}, so there is no topper to announce.`,
  )}`);
}

/** Post it — Telegram channel, every subject group, Discord, and all phones. */
export async function sendToppersNow(formData: FormData) {
  if (!(await requireArea("reports"))) return;
  const day = String(formData.get("day") ?? "") || istDay();
  const { rows, text } = await build(day);

  // HIS RULE: a day with no releases is not announced at all.
  if (!rows.length) {
    redirect(`/admin/reports/toppers?day=${day}&sent=${encodeURIComponent(
      `Nothing sent — no copies were released on ${day}.`,
    )}`);
  }

  const link = "https://caparveensharma.com/learn/performance";
  const [channel, groups, discord, push] = await Promise.all([
    import("@/lib/notify").then((m) => m.sendTelegramChannel(text, link)).catch(() => false),
    import("@/lib/telegramBroadcast").then((m) => m.postToAllGroups(text, link)).catch(() => 0),
    import("@/lib/discord").then((m) => m.postToDiscord(text, link)).catch(() => false),
    import("@/lib/push").then((m) => m.pushToEveryone({
      title: day === istDay() ? "🏆 Today's toppers" : `🏆 Toppers — ${new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}`,
      body: rows.map((r) => r.student_name).join(" · "),
      link: "/learn/performance",
    })).catch(() => null),
  ]);

  // Stamped so the 3 AM job does not congratulate the same students twice.
  await createServiceClient().from("daily_toppers")
    .update({ announced_at: new Date().toISOString() }).eq("day", day);

  revalidatePath("/admin/reports/toppers");
  redirect(`/admin/reports/toppers?day=${day}&sent=${encodeURIComponent(
    `Sent for ${day} — Telegram channel ${channel ? "✓" : "✗"}, ${groups} group(s), Discord ${discord ? "✓" : "✗"}` +
    `, phones ${push ? `${push.sent} sent / ${push.failed} failed` : "unavailable"}.`,
  )}`);
}

