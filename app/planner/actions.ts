"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadPlanInput } from "@/lib/planner/load";
import { generatePlan, type Plan } from "@/lib/planner/engine";
import type { SchedEntry } from "@/lib/plan";

// Adapt the engine's day-by-day output into the SchedEntry[] shape the dashboard
// TodayPlan widget + the weekly study reminders already read, so they keep
// working unchanged.
function toSchedule(plan: Plan): SchedEntry[] {
  return plan.days
    .filter((d) => d.stage !== "break")
    .map((d) => ({
      iso: d.date,
      date: new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
      label: d.meta ? `${d.task} — ${d.meta}` : d.task,
      mock: /mock/i.test(d.task),
    }));
}

// Save (create or regenerate) the student's plan. We persist the inputs in
// `setup` and a generated `schedule` snapshot (for TodayPlan + reminders); the
// rich /planner view always regenerates fresh from `setup` + live progress.
export async function savePlanSetup(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const revs = Number(formData.get("revisions"));
  const setup = {
    subjectId: String(formData.get("subject") || ""),
    startDate: String(formData.get("start") || ""),
    examDate: String(formData.get("exam") || ""),
    speed: Number(formData.get("speed")) || 1.2,
    doneClasses: Math.max(0, Number(formData.get("done")) || 0),
    revisions: revs === 1 || revs === 2 ? revs : 3,
  };
  if (!setup.subjectId || !setup.startDate || !setup.examDate) return;

  let schedule: SchedEntry[] = [];
  const input = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate, doneClasses: setup.doneClasses });
  if (input) {
    input.chosenSpeed = setup.speed;
    input.revisionRounds = setup.revisions;
    schedule = toSchedule(generatePlan(input));
  }

  await supabase.from("study_plans").upsert(
    { user_id: user.id, setup, schedule, remind: true, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  revalidatePath("/planner");
  redirect("/planner");
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Email the student their full plan + a link to open it and download as PDF.
export async function emailMyPlan() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: planRow } = await supabase.from("study_plans").select("setup").eq("user_id", user.id).maybeSingle();
  const setup = planRow?.setup as { subjectId: string; startDate: string; examDate: string; speed: number; doneClasses: number; revisions?: number } | null;
  if (!setup?.subjectId) return;

  const input = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate, doneClasses: setup.doneClasses });
  if (!input) return;
  input.chosenSpeed = setup.speed;
  input.revisionRounds = setup.revisions;
  const plan = generatePlan(input);

  const { data: prof } = await supabase.from("profiles").select("email").eq("id", user.id).maybeSingle();
  const to = (prof?.email as string) || user.email;
  if (!to) return;

  const rows = plan.days
    .filter((d) => d.stage !== "break")
    .slice(0, 400)
    .map((d) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap;color:#555">${d.weekday} ${d.date}</td><td style="padding:4px 8px;border-bottom:1px solid #eee"><strong>${esc(d.task)}</strong><br><span style="color:#666;font-size:12px">${esc(d.meta)}</span></td></tr>`)
    .join("");

  const { sendEmail, emailShell } = await import("@/lib/notify");
  const cta = `<a href="https://caparveensharma.com/planner" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Open my planner &amp; download PDF →</a>`;
  const html = emailShell(
    `Your study plan — ${esc(input.subjectTitle)}`,
    `<p>Exam on <strong>${setup.examDate}</strong>. Open your planner anytime to see today's target, track progress, and download it as a PDF.</p><p style="margin:14px 0">${cta}</p><table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>`,
  );
  await sendEmail(to, `Your study plan — ${input.subjectTitle}`, html);
  redirect("/planner?emailed=1");
}

export async function clearPlan() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("study_plans").update({ setup: null, schedule: [] }).eq("user_id", user.id);
  revalidatePath("/planner");
  redirect("/planner");
}
