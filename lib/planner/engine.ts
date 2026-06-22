// Study-plan scheduling engine (pure — no I/O). Given a subject's content +
// the planner config + a start/exam date, it lays out the backward timeline,
// distributes the detailed classes across the exhaustive window using the speed
// ladder to hit the 4-month target, runs a feasibility check, and emits the
// day-by-day rows for all four stages. Loading lives in load.ts.

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
  feasibility: { fits: boolean; speed: number; requiredHours: number; availableHours: number; shortfallHours: number; startedLate: boolean; messages: string[] };
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

// working (class) minutes available between two dates, Sundays excluded
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

  // Backward timeline for the revision rounds
  const rr1Start = addMonths(E, -cfg.rr1.start_months_before);
  const rr1End = addDays(rr1Start, cfg.rr1.days - 1);
  const rr2Start = addMonths(E, -cfg.rr2.start_months_before);
  const rr2End = addDays(rr2Start, cfg.rr2.days - 1);
  const rr3End = E;
  const rr3Start = addDays(E, -(cfg.rr3.days - 1));

  // Exhaustive content + speed ladder against the 4-month target window
  const done = Math.max(0, input.doneClasses ?? 0);
  const classes = input.classes;
  const remaining = classes.slice(done);
  const totalClassMin = remaining.reduce((s, c) => s + c.minutes, 0);
  const targetEnd = minDate(addMonths(start, input.params.target_months), rr1Start);
  const availToTarget = availMinutes(start, targetEnd, cfg.exhaustive_daily_hours, hwFactor);

  let speed = ladder[ladder.length - 1];
  let fits = false;
  for (const s of ladder) { if (totalClassMin / s <= availToTarget) { speed = s; fits = true; break; } }

  const requiredHours = totalClassMin / speed / 60;
  const availableHours = availToTarget / 60;
  const shortfallHours = Math.max(0, requiredHours - availableHours);
  const startedLate = start > addMonths(E, -input.params.start_months_before_exam);

  // Distribute classes day by day across the exhaustive window
  const days: PlanDay[] = [];
  let idx = done;
  let remainMin = idx < classes.length ? classes[idx].minutes / speed : 0;
  let cur = new Date(start);
  let lastShownTopic: string | null = null;
  const weeklyDone: string[] = [];
  let guard = 0;
  const hardStop = rr1Start;

  while (idx < classes.length && cur < hardStop && guard++ < 4000) {
    if (isSun(cur)) {
      const uniq = [...new Set(weeklyDone)];
      days.push({ date: iso(cur), weekday: wd(cur), stage: "exhaustive", stageLabel: "Stage 1 · Exhaustive", topic: null,
        task: uniq.length ? `Deep test — ${uniq.join(", ")}` : "Deep test (catch-up day)", meta: "MCQ + descriptive test in app", sunday: true, status: "test" });
      weeklyDone.length = 0;
      cur = addDays(cur, 1); continue;
    }
    let budget = cfg.exhaustive_daily_hours * 60 * hwFactor;
    const dayStartTopic = classes[idx].topicTitle;
    const labels: string[] = [];
    let watched = 0;
    while (idx < classes.length && budget > 0.5) {
      const c = classes[idx];
      const take = Math.min(budget, remainMin);
      budget -= take; remainMin -= take; watched += take;
      if (!labels.includes(c.label)) labels.push(c.label);
      if (remainMin <= 0.5) {
        if (!weeklyDone.includes(c.topicTitle)) weeklyDone.push(c.topicTitle);
        idx++;
        remainMin = idx < classes.length ? classes[idx].minutes / speed : 0;
      } else break; // class continues tomorrow
    }
    const topicCol: string | null = dayStartTopic !== lastShownTopic ? dayStartTopic : null;
    if (topicCol) lastShownTopic = topicCol;
    days.push({ date: iso(cur), weekday: wd(cur), stage: "exhaustive", stageLabel: "Stage 1 · Exhaustive", topic: topicCol,
      task: labels.join(", "), meta: `${hm(watched)} · watch at ${speed}× · do homework if any`, sunday: false, status: "ok" });
    cur = addDays(cur, 1);
  }
  const exhaustiveEnd = addDays(cur, -1);
  const overflow = idx < classes.length; // ran into RR1 before finishing

  // helper to add a single "study other subjects" break row for a date range
  const breakRow = (from: Date, to: Date, why: string) => {
    if (to <= from) return;
    days.push({ date: iso(from), weekday: wd(from), stage: "break", stageLabel: "Between stages", topic: null,
      task: `${fmtDay(from)} – ${fmtDay(addDays(to, -1))}: study your other subjects`, meta: why, sunday: false, status: "note" });
  };
  breakRow(addDays(exhaustiveEnd, 1), rr1Start, "margin before revision");

  // Revision rounds — spread topics (with their MIQs / revision videos) across the days
  const miqByTopic = new Map(input.miq.map((m) => [m.topicTitle, m]));
  const topicsInOrder = [...new Set(classes.map((c) => c.topicTitle))];
  const fillRound = (from: Date, to: Date, stage: "rr1" | "rr2" | "rr3", stageLabel: string, vSpeed: number, vPct: number | null, restLabel: string, useRev2: boolean) => {
    const total = workingDaysInclusive(from, to);
    let dayNo = 0;
    for (let c = new Date(from); c <= to; c = addDays(c, 1)) {
      const topic = topicsInOrder.length ? topicsInOrder[dayNo % topicsInOrder.length] : "All topics";
      const miqRow = miqByTopic.get(topic);
      const qs = (useRev2 ? miqRow?.rev2 : miqRow?.rev1) ?? [];
      const qLabel = qs.length ? ` · do ${qs.slice(0, 6).join(", ")}` : "";
      const task = vPct !== null
        ? `${topic} — revision video + ${restLabel}${qLabel}`
        : `Checklist: marked MIQs → quick pass earlier MIQs → revision videos → Mock 3 → re-check RTP`;
      const meta = vPct !== null ? `videos ${vPct}% at ${vSpeed}× · rest on ${restLabel}` : `final push at ${vSpeed}× · 11h/day`;
      days.push({ date: iso(c), weekday: wd(c), stage, stageLabel, topic: vPct !== null ? topic : "All topics", task, meta, sunday: isSun(c), status: "ok" });
      dayNo++;
    }
    return total;
  };

  if (!overflow) {
    fillRound(rr1Start, rr1End, "rr1", "Stage 2 · Revision round 1", cfg.rr1.video_speed, cfg.rr1.video_pct, "RTP / MTP / past papers / Mock 1", false);
    breakRow(addDays(rr1End, 1), rr2Start, "between revision rounds");
    fillRound(rr2Start, rr2End, "rr2", "Stage 3 · Revision round 2", cfg.rr2.video_speed, cfg.rr2.video_pct, "Mock 2", true);
    breakRow(addDays(rr2End, 1), rr3Start, "between revision rounds");
    fillRound(rr3Start, rr3End, "rr3", "Stage 4 · Revision round 3", cfg.rr3.video_speed, null, "", true);
  }

  // Feasibility messaging
  const messages: string[] = [];
  if (overflow) messages.push("The classes don't finish before Revision Round 1 even at top speed — add hours/days or start earlier.");
  if (startedLate) messages.push(`You're starting later than the recommended ${input.params.start_months_before_exam} months before the exam.`);
  if (!fits && !overflow) {
    const wDays = Math.max(1, workingDays(start, targetEnd));
    const extraPerDay = shortfallHours / wDays;
    const extraDays = Math.ceil((shortfallHours * 60) / (cfg.exhaustive_daily_hours * 60 * hwFactor));
    messages.push(`Short by ~${Math.round(shortfallHours)}h to hit the ${input.params.target_months}-month target. Fix: about +${extraPerDay.toFixed(1)} h/day, OR work ~${extraDays} extra days (e.g. Sundays), OR start earlier.`);
  }
  if (fits && !overflow) messages.push(`Fits at ${speed}× — classes finish around ${fmtDay(exhaustiveEnd)}, with margin before Revision Round 1.`);

  return {
    timeline: { exhaustiveStart: iso(start), exhaustiveEnd: iso(exhaustiveEnd), rr1: [iso(rr1Start), iso(rr1End)], rr2: [iso(rr2Start), iso(rr2End)], rr3: [iso(rr3Start), iso(rr3End)] },
    feasibility: { fits: fits && !overflow, speed, requiredHours: Math.round(requiredHours), availableHours: Math.round(availableHours), shortfallHours: Math.round(shortfallHours), startedLate, messages },
    days,
    totals: { classHours: Math.round(totalClassMin / 60), revisionHours: Math.round(input.revisions.reduce((s, r) => s + r.minutes, 0) / 60), classCount: remaining.length },
  };
}

function workingDaysInclusive(from: Date, to: Date) {
  let n = 0;
  for (let c = new Date(from); c <= to; c = addDays(c, 1)) n++;
  return n;
}
