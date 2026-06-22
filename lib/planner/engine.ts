// Study-plan scheduling engine (pure — no I/O). Given a subject's content +
// the planner config + a start/exam date + the student's chosen speed, it lays
// out the backward timeline, packs WHOLE classes (one per row, never split or
// crammed) into the exhaustive window, recommends a faster speed when the
// schedule is tight, runs a feasibility check, and emits day-by-day rows for
// all four stages. Loading lives in load.ts.

export type RR = { start_months_before: number; days: number; daily_hours: number; video_pct: number; video_speed: number };
export type PlannerConfig = {
  exhaustive_daily_hours: number;
  exhaustive_homework_pct: number;
  base_speed: number;
  max_speed: number;
  rr1: RR;
  rr2: RR;
  rr3: { days: number; daily_hours: number; video_speed: number };
};
export type SubjectParams = { start_months_before_exam: number; max_months: number; target_months: number };
export type ClassItem = { topicTitle: string; label: string; minutes: number };
export type RevItem = { topicTitle: string; minutes: number };
export type TopicMIQ = { topicTitle: string; rev1: string[]; rev2: string[] };

export type PlanInput = {
  subjectTitle: string;
  startDate: string; // yyyy-mm-dd
  examDate: string; // yyyy-mm-dd
  config: PlannerConfig;
  params: SubjectParams;
  classes: ClassItem[]; // ordered by importance then class no
  revisions: RevItem[];
  miq: TopicMIQ[];
  doneClasses?: number;
  chosenSpeed?: number; // the speed the student wants to watch at
};

export type PlanDay = {
  date: string;
  weekday: string;
  stage: "exhaustive" | "rr1" | "rr2" | "rr3" | "break";
  stageLabel: string;
  topic: string | null; // shown only when a topic starts
  task: string; // bold part
  meta: string; // small italic part
  sunday: boolean;
  status: "ok" | "test" | "note";
};

export type Plan = {
  timeline: { exhaustiveStart: string; exhaustiveEnd: string; rr1: [string, string]; rr2: [string, string]; rr3: [string, string] };
  feasibility: { fits: boolean; speed: number; recommendedSpeed: number | null; requiredHours: number; availableHours: number; shortfallHours: number; startedLate: boolean; messages: string[] };
  days: PlanDay[];
  totals: { classHours: number; revisionHours: number; classCount: number };
};

const DAY = 86400000;
const d = (s: string) => new Date(s + "T00:00:00");
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addDays = (x: Date, n: number) => new Date(x.getTime() + n * DAY);
function addMonths(x: Date, n: number) { const r = new Date(x); r.setMonth(r.getMonth() + n); return r; }
const isSun = (x: Date) => x.getDay() === 0;
const wd = (x: Date) => x.toLocaleDateString("en-IN", { weekday: "short" });
const fmtDay = (x: Date) => x.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const minDate = (a: Date, b: Date) => (a < b ? a : b);
function hm(mins: number) {
  const m = Math.round(mins); const h = Math.floor(m / 60); const r = m % 60;
  return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}
function availMinutes(from: Date, to: Date, dailyHours: number, hwFactor: number) {
  let mins = 0;
  for (let c = new Date(from); c < to; c = addDays(c, 1)) if (!isSun(c)) mins += dailyHours * 60 * hwFactor;
  return mins;
}
function workingDays(from: Date, to: Date) {
  let n = 0;
  for (let c = new Date(from); c < to; c = addDays(c, 1)) if (!isSun(c)) n++;
  return n;
}

export function generatePlan(input: PlanInput): Plan {
  const cfg = input.config;
  const E = d(input.examDate);
  const start = d(input.startDate);
  const hwFactor = 1 - cfg.exhaustive_homework_pct / 100;
  const ladder = Array.from(new Set([cfg.base_speed, 1.5, cfg.max_speed])).sort((a, b) => a - b);

  const rr1Start = addMonths(E, -cfg.rr1.start_months_before);
  const rr1End = addDays(rr1Start, cfg.rr1.days - 1);
  const rr2Start = addMonths(E, -cfg.rr2.start_months_before);
  const rr2End = addDays(rr2Start, cfg.rr2.days - 1);
  const rr3End = E;
  const rr3Start = addDays(E, -(cfg.rr3.days - 1));

  const done = Math.max(0, input.doneClasses ?? 0);
  const classes = input.classes;
  const remaining = classes.slice(done);
  const totalClassMin = remaining.reduce((s, c) => s + c.minutes, 0);
  const targetEnd = minDate(addMonths(start, input.params.target_months), rr1Start);
  const availToTarget = availMinutes(start, targetEnd, cfg.exhaustive_daily_hours, hwFactor);

  // Student-chosen speed; recommend a faster one if it won't fit the target.
  const speed = input.chosenSpeed && input.chosenSpeed > 0 ? input.chosenSpeed : cfg.base_speed;
  const fitsChosen = totalClassMin / speed <= availToTarget;
  let recommendedSpeed: number | null = null;
  if (!fitsChosen) for (const s of ladder) if (s > speed && totalClassMin / s <= availToTarget) { recommendedSpeed = s; break; }

  const requiredHours = totalClassMin / speed / 60;
  const availableHours = availToTarget / 60;
  const shortfallHours = Math.max(0, requiredHours - availableHours);
  const startedLate = start > addMonths(E, -input.params.start_months_before_exam);

  // Pack WHOLE classes into days (one class per row, never split). A class that
  // alone exceeds a day's budget still gets its own day.
  const days: PlanDay[] = [];
  let i = done;
  let cur = new Date(start);
  let lastShownTopic: string | null = null;
  const weeklyDone: string[] = [];
  let guard = 0;
  while (i < classes.length && cur < rr1Start && guard++ < 6000) {
    if (isSun(cur)) {
      const uniq = [...new Set(weeklyDone)];
      days.push({ date: iso(cur), weekday: wd(cur), stage: "exhaustive", stageLabel: "Stage 1 · Exhaustive", topic: null,
        task: uniq.length ? `Deep test — ${uniq.join(", ")}` : "Deep test (catch-up day)", meta: "MCQ + descriptive test in app", sunday: true, status: "test" });
      weeklyDone.length = 0;
      cur = addDays(cur, 1); continue;
    }
    let budget = cfg.exhaustive_daily_hours * 60 * hwFactor; // wall-clock minutes
    let placed = 0;
    while (i < classes.length) {
      const c = classes[i];
      const eff = c.minutes / speed; // wall-clock time at chosen speed
      if (placed > 0 && eff > budget + 0.5) break; // doesn't fit today
      const topicCol: string | null = c.topicTitle !== lastShownTopic ? c.topicTitle : null;
      if (topicCol) lastShownTopic = topicCol;
      days.push({ date: iso(cur), weekday: wd(cur), stage: "exhaustive", stageLabel: "Stage 1 · Exhaustive", topic: topicCol,
        task: `${c.label} · ${c.topicTitle}`, meta: `${hm(c.minutes)} · watch at ${speed}× · do homework if any`, sunday: false, status: "ok" });
      budget -= eff; placed++;
      if (!weeklyDone.includes(c.topicTitle)) weeklyDone.push(c.topicTitle);
      i++;
      if (budget <= 0.5) break;
    }
    cur = addDays(cur, 1);
  }
  const exhaustiveEnd = addDays(cur, -1);
  const overflow = i < classes.length;

  const breakRow = (from: Date, to: Date, why: string) => {
    if (to <= from) return;
    days.push({ date: iso(from), weekday: wd(from), stage: "break", stageLabel: "Between stages", topic: null,
      task: `${fmtDay(from)} – ${fmtDay(addDays(to, -1))}: study your other subjects`, meta: why, sunday: false, status: "note" });
  };
  breakRow(addDays(exhaustiveEnd, 1), rr1Start, "margin before revision");

  const miqByTopic = new Map(input.miq.map((m) => [m.topicTitle, m]));
  const topicsInOrder = [...new Set(classes.map((c) => c.topicTitle))];
  const fillRound = (from: Date, to: Date, stage: "rr1" | "rr2" | "rr3", stageLabel: string, vSpeed: number, checklist: boolean, restLabel: string, useRev2: boolean) => {
    let dayNo = 0;
    for (let c = new Date(from); c <= to; c = addDays(c, 1)) {
      const topic = topicsInOrder.length ? topicsInOrder[dayNo % topicsInOrder.length] : "All topics";
      const qs = (useRev2 ? miqByTopic.get(topic)?.rev2 : miqByTopic.get(topic)?.rev1) ?? [];
      const qLabel = qs.length ? ` · do ${qs.slice(0, 6).join(", ")}` : "";
      const task = checklist
        ? "Checklist: marked MIQs → quick pass earlier MIQs → revision videos → Mock 3 → re-check RTP"
        : `${topic} — revision video + ${restLabel}${qLabel}`;
      const meta = checklist ? `final push at ${vSpeed}× · ${cfg.rr3.daily_hours}h/day` : `watch revision video at ${vSpeed}×`;
      days.push({ date: iso(c), weekday: wd(c), stage, stageLabel, topic: checklist ? "All topics" : topic, task, meta, sunday: isSun(c), status: "ok" });
      dayNo++;
    }
  };

  if (!overflow) {
    fillRound(rr1Start, rr1End, "rr1", "Stage 2 · Revision round 1", cfg.rr1.video_speed, false, "RTP / MTP / past papers / Mock 1", false);
    breakRow(addDays(rr1End, 1), rr2Start, "between revision rounds");
    fillRound(rr2Start, rr2End, "rr2", "Stage 3 · Revision round 2", cfg.rr2.video_speed, false, "Mock 2", true);
    breakRow(addDays(rr2End, 1), rr3Start, "between revision rounds");
    fillRound(rr3Start, rr3End, "rr3", "Stage 4 · Revision round 3", cfg.rr3.video_speed, true, "", true);
  }

  const messages: string[] = [];
  if (startedLate) messages.push(`You're starting later than the recommended ${input.params.start_months_before_exam} months before the exam.`);
  if (fitsChosen && !overflow) {
    messages.push(`Fits at ${speed}× — classes finish around ${fmtDay(exhaustiveEnd)}, with margin before Revision Round 1.`);
  } else if (recommendedSpeed) {
    messages.push(`Tight at ${speed}×. Watch at ${recommendedSpeed}× to finish on time and save days.`);
  } else {
    const wDays = Math.max(1, workingDays(start, targetEnd));
    const extraPerDay = shortfallHours / wDays;
    const extraDays = Math.ceil((shortfallHours * 60) / (cfg.exhaustive_daily_hours * 60 * hwFactor));
    messages.push(`Even at ${cfg.max_speed}× you're short ~${Math.round(shortfallHours)}h. Add about +${extraPerDay.toFixed(1)} h/day, OR ~${extraDays} extra days (e.g. Sundays), OR start earlier.`);
  }

  return {
    timeline: { exhaustiveStart: iso(start), exhaustiveEnd: iso(exhaustiveEnd), rr1: [iso(rr1Start), iso(rr1End)], rr2: [iso(rr2Start), iso(rr2End)], rr3: [iso(rr3Start), iso(rr3End)] },
    feasibility: { fits: fitsChosen && !overflow, speed, recommendedSpeed, requiredHours: Math.round(requiredHours), availableHours: Math.round(availableHours), shortfallHours: Math.round(shortfallHours), startedLate, messages },
    days,
    totals: { classHours: Math.round(totalClassMin / 60), revisionHours: Math.round(input.revisions.reduce((s, r) => s + r.minutes, 0) / 60), classCount: remaining.length },
  };
}
