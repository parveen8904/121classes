"use server";

import { todayIST } from "@/lib/dates";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadPlanInput, applySetup, type PlanSetup } from "@/lib/planner/load";
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
  const num = (k: string) => { const v = Number(formData.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const sc = (k: string, allowSkip: boolean) => { const v = String(formData.get(k) || "all"); return (allowSkip ? ["all", "ab", "a", "skip"] : ["all", "ab", "a"]).includes(v) ? v : "all"; };
  const dlist = (k: string) => String(formData.get(k) || "").split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const setup: PlanSetup = {
    subjectId: String(formData.get("subject") || ""),
    startDate: String(formData.get("start") || ""),
    examDate: String(formData.get("exam") || ""),
    speed: Number(formData.get("speed")) || 1.2,
    doneClasses: Math.max(0, Number(formData.get("done")) || 0),
    revisions: revs === 1 || revs === 2 ? revs : 3,
    exhaustiveScope: sc("ex_scope", true) as PlanSetup["exhaustiveScope"],
    pickedTopicIds: formData.getAll("pick").map(String).filter(Boolean),
    revScope1: sc("rev1_scope", false) as PlanSetup["revScope1"],
    revScope2: sc("rev2_scope", false) as PlanSetup["revScope2"],
    stageDays: { exhaustive: num("d_ex"), rr1: num("d_rr1"), rr2: num("d_rr2"), rr3: num("d_rr3") },
    holidays: dlist("holidays"),
    extraDays: dlist("extra_days"),
    sundaysOn: formData.get("sundays_on") === "on",
  };
  if (!setup.subjectId || !setup.startDate || !setup.examDate) return;

  let schedule: SchedEntry[] = [];
  const input = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate, doneClasses: setup.doneClasses });
  if (input) {
    applySetup(input, setup);
    schedule = toSchedule(generatePlan(input));
  }

  await supabase.from("study_plans").upsert(
    { user_id: user.id, setup, schedule, remind: true, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  revalidatePath("/planner");
  redirect("/planner");
}

// One-tap READY-MADE plan: "N days before exam" with sensible expert defaults
// for that horizon. The student can modify or regenerate it anytime — the
// planner page says so right on top of the result.
export async function applyPlanTemplate(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const subjectId = String(formData.get("subject") || "");
  const days = Number(formData.get("days")) || 0;
  if (!subjectId || ![15, 30, 60, 90, 150, 180].includes(days)) return;

  const start = todayIST();
  const exam = new Date(start + "T00:00:00Z");
  exam.setUTCDate(exam.getUTCDate() + days);
  const examDate = exam.toISOString().slice(0, 10);

  // Horizon-tuned defaults: short runways watch faster, cover the most
  // important topics and keep fewer revision rounds.
  const setup: PlanSetup = {
    subjectId,
    startDate: start,
    examDate,
    speed: days <= 30 ? 1.5 : 1.25,
    doneClasses: 0,
    revisions: days <= 30 ? 1 : days <= 60 ? 2 : 3,
    exhaustiveScope: (days <= 15 ? "a" : days <= 30 ? "ab" : "all") as PlanSetup["exhaustiveScope"],
    pickedTopicIds: [],
    revScope1: "all" as PlanSetup["revScope1"],
    revScope2: "all" as PlanSetup["revScope2"],
    stageDays: {},
    holidays: [],
    extraDays: [],
    sundaysOn: days <= 30,
  };

  let schedule: SchedEntry[] = [];
  const input = await loadPlanInput({ subjectId, startDate: setup.startDate, examDate, doneClasses: 0 });
  if (input) {
    applySetup(input, setup);
    schedule = toSchedule(generatePlan(input));
  }

  await supabase.from("study_plans").upsert(
    { user_id: user.id, setup, schedule, remind: true, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  revalidatePath("/planner");
  redirect(`/planner?template=${days}`);
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
  applySetup(input, setup as PlanSetup);
  const plan = generatePlan(input);

  const { data: prof } = await supabase.from("profiles").select("email").eq("id", user.id).maybeSingle();
  const to = (prof?.email as string) || user.email;
  if (!to) return;

  const rows = plan.days
    .filter((d) => d.stage !== "break")
    .slice(0, 400)
    .map((d) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap;color:#555">${d.weekday} ${d.date}</td><td style="padding:4px 8px;border-bottom:1px solid #eee"><strong>${esc(d.task)}</strong><br><span style="color:#666;font-size:12px">${esc(d.meta)}</span></td></tr>`)
    .join("");

  const { sendEmail, sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  const cta = `<a href="https://caparveensharma.com/planner" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Open my planner →</a>`;
  const html = emailShell(
    `Your study plan — ${esc(input.subjectTitle)}`,
    `<p>Exam on <strong>${setup.examDate}</strong>. Your full plan is attached as a PDF. Open your planner anytime to see today's target and track progress.</p><p style="margin:14px 0">${cta}</p><table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>`,
  );
  const subject = `Your study plan — ${input.subjectTitle}`;
  let attached = false;
  try {
    const { renderPlanPdf } = await import("@/lib/planner/pdf");
    const buf = await renderPlanPdf(plan, { subjectTitle: input.subjectTitle, examDate: setup.examDate });
    attached = await sendEmailWithAttachment(to, subject, html, { filename: "study-plan.pdf", content: buf, contentType: "application/pdf" });
  } catch { attached = false; }
  if (!attached) await sendEmail(to, subject, html);
  redirect("/planner?emailed=1");
}

// Toggle a class done/undone from the plan (instant client feedback; this just
// persists the truth).
export async function setClassDone(sectionId: string, done: boolean) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !sectionId) return;
  const { data: existing } = await supabase.from("class_watch").select("id").eq("student_id", user.id).eq("section_id", sectionId).maybeSingle();
  if (existing) await supabase.from("class_watch").update({ completed: done, last_watched_at: new Date().toISOString() }).eq("id", existing.id);
  else if (done) await supabase.from("class_watch").insert({ student_id: user.id, section_id: sectionId, completed: true });
  revalidatePath("/planner");
}

// Mark one class complete by hand (in case it was watched elsewhere).
export async function markClassDone(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const sectionId = String(formData.get("sectionId") || "");
  if (!sectionId) return;
  const { data: existing } = await supabase.from("class_watch").select("id").eq("student_id", user.id).eq("section_id", sectionId).maybeSingle();
  if (existing) await supabase.from("class_watch").update({ completed: true, last_watched_at: new Date().toISOString() }).eq("id", existing.id);
  else await supabase.from("class_watch").insert({ student_id: user.id, section_id: sectionId, completed: true });
  revalidatePath("/planner");
}

// Re-balance: restart the plan from today, counting already-completed classes as
// done, so missed days don't pile up — the remaining work spreads over the days left.
export async function rebalanceFromToday() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: planRow } = await supabase.from("study_plans").select("setup").eq("user_id", user.id).maybeSingle();
  const setup = planRow?.setup as PlanSetup | null;
  if (!setup?.subjectId) return;

  const base = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate });
  if (!base) return;
  const { data: cw } = await supabase.from("class_watch").select("section_id").eq("student_id", user.id).eq("completed", true);
  const completed = new Set((cw ?? []).map((r) => r.section_id as string));
  const scope = setup.exhaustiveScope ?? "all";
  const picked = setup.pickedTopicIds && setup.pickedTopicIds.length ? new Set(setup.pickedTopicIds) : null;
  const scoped = scope === "skip" ? [] : picked ? base.classes.filter((c) => picked.has(c.topicId)) : base.classes.filter((c) => (scope === "a" ? c.importance === "A" : scope === "ab" ? c.importance === "A" || c.importance === "B" : true));
  const doneCount = scoped.filter((c) => completed.has(c.sectionId)).length;

  const newSetup: PlanSetup = { ...setup, startDate: todayIST(), doneClasses: doneCount };
  let schedule: SchedEntry[] = [];
  const input = await loadPlanInput({ subjectId: newSetup.subjectId, startDate: newSetup.startDate, examDate: newSetup.examDate, doneClasses: newSetup.doneClasses });
  if (input) { applySetup(input, newSetup); schedule = toSchedule(generatePlan(input)); }
  await supabase.from("study_plans").update({ setup: newSetup, schedule, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  revalidatePath("/planner");
  redirect("/planner?rebalanced=1");
}

export async function clearPlan() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("study_plans").update({ setup: null, schedule: [] }).eq("user_id", user.id);
  revalidatePath("/planner");
  redirect("/planner");
}
