import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage } from "@/lib/notify";
import { loadPlanInput } from "@/lib/planner/load";
import { generatePlan } from "@/lib/planner/engine";

type Setup = { subjectId: string; startDate: string; examDate: string; speed: number; doneClasses: number; revisions?: number };

// Once a day, message each student (with a plan + linked Telegram) their target
// for today plus a delay warning if they're behind. Deduped via the
// notifications log so it sends at most once per day. Called by the daily cron.
export async function runDailyTargets(): Promise<{ sent: number }> {
  const svc = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: plans } = await svc.from("study_plans").select("user_id, setup").not("setup", "is", null).limit(5000);
  let sent = 0;

  for (const p of plans ?? []) {
    const setup = p.setup as Setup | null;
    if (!setup?.subjectId || !setup.examDate || setup.examDate < today) continue;

    const { data: prof } = await svc.from("profiles").select("telegram_chat_id").eq("id", p.user_id).maybeSingle();
    const chat = prof?.telegram_chat_id as string | null;
    if (!chat) continue; // only Telegram-linked students (mobile push comes later)

    const { data: marker } = await svc
      .from("notifications").select("id").eq("template", "daily_target")
      .contains("payload", { user_id: p.user_id, day: today }).maybeSingle();
    if (marker) continue;

    const input = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate, doneClasses: setup.doneClasses });
    if (!input) continue;
    input.chosenSpeed = setup.speed;
    input.revisionRounds = setup.revisions;
    const plan = generatePlan(input);

    const todays = plan.days.filter((d) => d.date === today && d.stage !== "break");

    // Behind check: completed classes vs planned-by-today.
    const { data: cw } = await svc.from("class_watch").select("section_id").eq("student_id", p.user_id).eq("completed", true);
    const completed = new Set((cw ?? []).map((r) => r.section_id as string));
    const { data: topics } = await svc.from("topics").select("id").eq("subject_id", setup.subjectId);
    const tIds = (topics ?? []).map((t) => t.id as string);
    const { data: cls } = tIds.length ? await svc.from("sections").select("id").eq("type", "full_class_video").in("topic_id", tIds) : { data: [] as { id: string }[] };
    const done = Math.max((cls ?? []).filter((s) => completed.has(s.id as string)).length, setup.doneClasses || 0);
    const plannedByToday = (setup.doneClasses || 0) + plan.days.filter((d) => d.stage === "exhaustive" && d.status === "ok" && d.date <= today).length;
    const behind = plannedByToday - done;

    const lines = todays.length ? todays.map((d) => `• ${d.task} (${d.meta})`).join("\n") : "No class today — revise or study your other subjects.";
    const warn = behind > 0 ? `\n\n⚠️ You're ${behind} class(es) behind — try to catch up today.` : "";
    const text = `🎯 Today's target — ${input.subjectTitle}\n\n${lines}${warn}`;

    const ok = await sendTelegramMessage(chat, text);
    await svc.from("notifications").insert({ student_id: p.user_id, channel: "whatsapp", template: "daily_target", payload: { user_id: p.user_id, day: today }, status: ok ? "sent" : "skipped", sent_at: ok ? new Date().toISOString() : null });
    if (ok) sent++;
  }
  return { sent };
}
