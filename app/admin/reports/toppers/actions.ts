"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../../_lib/util";
import { istDay, recordToppers, toppersMessage } from "@/lib/dailyToppers";
import { announceToppers, type Channel } from "@/lib/toppersAnnounce";

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
  const { rows } = await build(day);

  // HIS RULE: a day with no releases is not announced at all.
  if (!rows.length) {
    redirect(`/admin/reports/toppers?day=${day}&sent=${encodeURIComponent(
      `Nothing sent — no copies were released on ${day}.`,
    )}`);
  }

  // A DAY STILL RUNNING HAS NO TOPPER YET.
  //
  // His point, and it is right: at any hour before midnight another copy may
  // still be released and beat whoever leads now. The nightly job decides at
  // 11:59 PM for exactly that reason, so sending today's by hand would
  // announce a leader, not a topper — and the stamp would then stop 3 AM
  // correcting it. Yesterday and earlier are settled and send freely.
  if (day >= istDay()) {
    redirect(`/admin/reports/toppers?day=${day}&sent=${encodeURIComponent(
      `${day} is not over yet — another copy released today could still change who tops. It is decided at 11:59 PM and announced at 3 AM. Use "Show me the message" to see how it stands now.`,
    )}`);
  }

  // "Phones only" exists because the four channels do not always need
  // re-sending together — see lib/toppersAnnounce.ts.
  const only = (str(formData.get("only")) || null) as Channel | null;
  const r = await announceToppers(day, rows, only);

  // Stamped so the 3 AM job does not congratulate the same students twice.
  await createServiceClient().from("daily_toppers")
    .update({ announced_at: new Date().toISOString() }).eq("day", day);

  revalidatePath("/admin/reports/toppers");
  redirect(`/admin/reports/toppers?day=${day}&sent=${encodeURIComponent(
    only === "push"
      ? `Phones only, for ${day} — ${r.push ? `${r.push.sent} sent / ${r.push.failed} failed` : "unavailable"}. Telegram and Discord were not touched.`
      : `Sent for ${day} — Telegram channel ${r.channel ? "✓" : "✗"}, ${r.groups} group(s), Discord ${r.discord ? "✓" : "✗"}` +
        `, phones ${r.push ? `${r.push.sent} sent / ${r.push.failed} failed` : "unavailable"}.`,
  )}`);
}

