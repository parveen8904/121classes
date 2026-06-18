import { createServiceClient } from "@/lib/supabase/service";
import { buildSchedule, thisWeekEntries, type PlanSetup, type SchedEntry } from "@/lib/plan";
import { sendEmail, emailShell, sendTelegramMessage } from "@/lib/notify";

// Sends each student a "this week's plan" nudge — at most once per ISO week
// (deduped via the notifications log). Recomputes the schedule from their setup
// so it's always accurate. Triggered by the hourly cron.
function isoWeek(d: Date): string {
  const t = new Date(d.getTime());
  t.setUTCHours(0, 0, 0, 0);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${wk}`;
}

export async function runStudyReminders(): Promise<{ sent: number }> {
  const svc = createServiceClient();
  const now = new Date();
  const week = isoWeek(now);

  const { data: plans } = await svc
    .from("study_plans")
    .select("user_id, setup, schedule, remind")
    .eq("remind", true)
    .limit(2000);

  let sent = 0;
  for (const p of plans ?? []) {
    const setup = p.setup as PlanSetup | null;
    if (!setup?.examDate) continue;
    // Stop once the exam has passed.
    if (new Date(setup.examDate).getTime() < now.getTime()) continue;

    // Already reminded this week?
    const { data: marker } = await svc
      .from("notifications")
      .select("id")
      .eq("template", "study_reminder")
      .contains("payload", { user_id: p.user_id, week })
      .maybeSingle();
    if (marker) continue;

    const schedule: SchedEntry[] = (p.schedule as SchedEntry[]) ?? buildSchedule(setup, now);
    const wk = thisWeekEntries(schedule, now);
    if (wk.length === 0) continue;
    const body = wk.map((e) => `• ${e.label}`).join("\n");

    const { data: prof } = await svc.from("profiles").select("email, telegram_chat_id, full_name").eq("id", p.user_id).maybeSingle();
    let delivered = false;
    const text = `📅 Your study plan this week:\n\n${body}\n\nKeep going — small steps daily! 💪`;
    if (prof?.telegram_chat_id) delivered = await sendTelegramMessage(prof.telegram_chat_id, text);
    if (!delivered && prof?.email) {
      delivered = await sendEmail(prof.email, "📅 Your study plan this week — 121 CA Classes", emailShell("This week's study plan", `<p>${body.replace(/\n/g, "<br/>")}</p><p>Keep going — small steps daily! 💪</p>`));
    }

    await svc.from("notifications").insert({
      student_id: p.user_id,
      channel: prof?.telegram_chat_id ? "whatsapp" : "email",
      template: "study_reminder",
      payload: { user_id: p.user_id, week },
      status: delivered ? "sent" : "skipped",
      sent_at: delivered ? new Date().toISOString() : null,
    });
    if (delivered) sent++;
  }
  return { sent };
}
