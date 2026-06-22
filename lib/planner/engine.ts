// Study-plan scheduling engine (pure — no I/O). Lays out the four stages
// backward from the exam, packs whole classes into the exhaustive window with a
// speed ladder, runs a feasibility check, and emits day-by-day rows. The student
// controls: revision-round count (1/2/3), topic scope per stage (All/A+B/A-only,
// hand-pick, or skip exhaustive), watch speed, and each stage's length in days.

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
export type ClassItem = { sectionId: string; topicId: string; topicTitle: string; importance: string; label: string; minutes: number };
export type RevItem = { topicTitle: string; minutes: number };
export type TopicMIQ = { topicTitle: string; rev1: string[]; rev2: string[] };
export type TopicMeta = { topicId: string; title: string; importance: string };
export type Scope = "all" | "ab" | "a" | "skip";

export type PlanInput = {
  subjectTitle: string;
  startDate: string;
  examDate: string;
  config: PlannerConfig;
  params: SubjectParams;
  classes: ClassItem[];
  revisions: RevItem[];
  miq: TopicMIQ[];
  topics: TopicMeta[];
  doneClasses?: number;
  chosenSpeed?: number;
  revisionRounds?: number; // 3 / 2 / 1
  exhaustiveScope?: Scope; // all | ab | a | skip
  pickedTopicIds?: string[]; // overrides scope when non-empty
  revScope1?: Exclude<Scope, "skip">;
  revScope2?: Exclude<Scope, "skip">;
  stageDays?: { exhaustive?: number; rr1?: number; rr2?: number; rr3?: number };
  holidays?: string[]; // yyyy-mm-dd to skip entirely
  extraDays?: string[]; // yyyy-mm-dd to force as working days (e.g. a Sunday)
  sundaysOn?: boolean; // study on Sundays in the exhaustive stage too
};

export type PlanDay = {
  date: string; weekday: string;
  stage: "exhaustive" | "rr1" | "rr2" | "rr3" | "break";
  stageLabel: string; topic: string | null; task: string; meta: string; sunday: boolean; status: "ok" | "test" | "note"; sectionId?: string;
};

export type Plan = {
  timeline: { exhaustiveStart: string; exhaustiveEnd: string; rr1: [string, string]; rr2: [string, string]; rr3: [string, string] };
  feasibility: { fits: boolean; speed: number; recommendedSpeed: number | null; revisionRounds: number; recommendedRounds: number | null; requiredHours: number; availableHours: number; shortfallHours: number; startedLate: boolean; messages: string[] };
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
function hm(mins: number) { const m = Math.round(mins); const h = Math.floor(m / 60); const r = m % 60; return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`; }
function inScope(importance: string, scope: Scope): boolean {
  const imp = (importance || "").toUpperCase();
  if (scope === "a") return imp === "A";
  if (scope === "ab") return imp === "A" || imp === "B";
  return true; // "all"
}

export function generatePlan(input: PlanInput): Plan {
  const cfg = input.config;
  const E = d(input.examDate);
  const start = d(input.startDate);
  const hwFactor = 1 - cfg.exhaustive_homework_pct / 100;
  const ladder = Array.from(new Set([cfg.base_speed, 1.5, cfg.max_speed])).sort((a, b) => a - b);

  // Working-day rule for the exhaustive stage: holidays off, Sundays off unless
  // the student turned them on or added that date as an extra working day.
  const holidaySet = new Set(input.holidays ?? []);
  const extraSet = new Set(input.extraDays ?? []);
  const sundaysOn = !!input.sundaysOn;
  const isWork = (x: Date): boolean => {
    const k = iso(x);
    if (holidaySet.has(k)) return false;
    if (extraSet.has(k)) return true;
    return sundaysOn ? true : !isSun(x);
  };
  const countWork = (from: Date, to: Date): number => { let n = 0; for (let c = new Date(from); c < to; c = addDays(c, 1)) if (isWork(c)) n++; return n; };

  const rounds = input.revisionRounds === 1 || input.revisionRounds === 2 ? input.revisionRounds : 3;
  const includeR1 = rounds >= 2;
  const includeR2 = rounds >= 3;

  // Stage lengths (student overrides default to config). Laid out contiguously
  // backward from the exam: …exhaustive → RR1 → RR2 → final.
  const sd = input.stageDays ?? {};
  const rr3Days = Math.max(1, Math.round(sd.rr3 || cfg.rr3.days));
  const rr2Days = includeR2 ? Math.max(1, Math.round(sd.rr2 || cfg.rr2.days)) : 0;
  const rr1Days = includeR1 ? Math.max(1, Math.round(sd.rr1 || cfg.rr1.days)) : 0;

  const rr3End = E;
  const rr3Start = addDays(E, -(rr3Days - 1));
  let rr2Start = rr3Start, rr2End = rr3Start, rr1Start = rr3Start, rr1End = rr3Start;
  if (includeR1) {
    if (includeR2) {
      rr2End = addDays(rr3Start, -1); rr2Start = addDays(rr2End, -(rr2Days - 1));
      rr1End = addDays(rr2Start, -1); rr1Start = addDays(rr1End, -(rr1Days - 1));
    } else {
      rr1End = addDays(rr3Start, -1); rr1Start = addDays(rr1End, -(rr1Days - 1));
    }
  }
  const exhaustiveDeadline = includeR1 ? rr1Start : rr3Start;

  // Exhaustive class set, filtered by scope / hand-pick.
  const scope: Scope = input.exhaustiveScope ?? "all";
  const picked = input.pickedTopicIds && input.pickedTopicIds.length ? new Set(input.pickedTopicIds) : null;
  let scopedClasses: ClassItem[];
  if (scope === "skip") scopedClasses = [];
  else if (picked) scopedClasses = input.classes.filter((c) => picked.has(c.topicId));
  else scopedClasses = input.classes.filter((c) => inScope(c.importance, scope));

  const done = Math.max(0, input.doneClasses ?? 0);
  const remaining = scopedClasses.slice(done);
  const totalClassMin = remaining.reduce((s, c) => s + c.minutes, 0);

  const availWorkingDays = countWork(start, exhaustiveDeadline);
  const exCap = sd.exhaustive && sd.exhaustive > 0 ? Math.min(Math.round(sd.exhaustive), availWorkingDays) : availWorkingDays;
  const availToTarget = exCap * cfg.exhaustive_daily_hours * 60 * hwFactor;

  const speed = input.chosenSpeed && input.chosenSpeed > 0 ? input.chosenSpeed : cfg.base_speed;
  const fitsChosen = totalClassMin / speed <= availToTarget;
  let recommendedSpeed: number | null = null;
  if (!fitsChosen) for (const s of ladder) if (s > speed && totalClassMin / s <= availToTarget) { recommendedSpeed = s; break; }

  const requiredHours = totalClassMin / speed / 60;
  const availableHours = availToTarget / 60;
  const shortfallHours = Math.max(0, requiredHours - availableHours);
  const startedLate = start > addMonths(E, -input.params.start_months_before_exam);

  // Pack whole classes into the exhaustive window (one class per row).
  const days: PlanDay[] = [];
  let i = 0;
  let cur = new Date(start);
  let lastShownTopic: string | null = null;
  const weeklyDone: string[] = [];
  let exDaysUsed = 0;
  let guard = 0;
  while (i < remaining.length && cur < exhaustiveDeadline && guard++ < 6000) {
    if (!isWork(cur)) {
      if (isSun(cur) && !holidaySet.has(iso(cur))) {
        const uniq = [...new Set(weeklyDone)];
        days.push({ date: iso(cur), weekday: wd(cur), stage: "exhaustive", stageLabel: "Stage 1 · Exhaustive", topic: null, task: uniq.length ? `Deep test — ${uniq.join(", ")}` : "Deep test (catch-up day)", meta: "MCQ + descriptive test in app", sunday: true, status: "test" });
        weeklyDone.length = 0;
      }
      cur = addDays(cur, 1); continue;
    }
    if (exDaysUsed >= exCap) break;
    exDaysUsed++;
    let budget = cfg.exhaustive_daily_hours * 60 * hwFactor;
    let placed = 0;
    while (i < remaining.length) {
      const c = remaining[i];
      const eff = c.minutes / speed;
      if (placed > 0 && eff > budget + 0.5) break;
      const topicCol: string | null = c.topicTitle !== lastShownTopic ? c.topicTitle : null;
      if (topicCol) lastShownTopic = topicCol;
      days.push({ date: iso(cur), weekday: wd(cur), stage: "exhaustive", stageLabel: "Stage 1 · Exhaustive", topic: topicCol, task: `${c.label} · ${c.topicTitle}`, meta: `${hm(c.minutes)} · watch at ${speed}× · do homework if any`, sunday: false, status: "ok", sectionId: c.sectionId });
      budget -= eff; placed++;
      if (!weeklyDone.includes(c.topicTitle)) weeklyDone.push(c.topicTitle);
      i++;
      if (budget <= 0.5) break;
    }
    cur = addDays(cur, 1);
  }
  const exhaustiveEnd = addDays(cur, -1);
  const overflow = i < remaining.length;
  const ratioBroken = includeR1 && exDaysUsed > 0 && exDaysUsed < 3 * rr1Days;

  const breakRow = (from: Date, to: Date, why: string) => {
    if (to <= from) return;
    days.push({ date: iso(from), weekday: wd(from), stage: "break", stageLabel: "Between stages", topic: null, task: `${fmtDay(from)} – ${fmtDay(addDays(to, -1))}: study your other subjects`, meta: why, sunday: false, status: "note" });
  };

  const miqByTopic = new Map(input.miq.map((m) => [m.topicTitle, m]));
  const topicNames = (sc: Scope): string[] => {
    const f = input.topics.filter((t) => inScope(t.importance, sc)).map((t) => t.title);
    return f.length ? f : input.topics.map((t) => t.title);
  };
  const fillRound = (from: Date, to: Date, stage: "rr1" | "rr2" | "rr3", stageLabel: string, vSpeed: number, checklist: boolean, restLabel: string, useRev2: boolean, topicList: string[]) => {
    let dayNo = 0;
    for (let c = new Date(from); c <= to; c = addDays(c, 1)) {
      const topic = topicList.length ? topicList[dayNo % topicList.length] : "All topics";
      const qs = (useRev2 ? miqByTopic.get(topic)?.rev2 : miqByTopic.get(topic)?.rev1) ?? [];
      const qLabel = qs.length ? ` · do ${qs.slice(0, 6).join(", ")}` : "";
      const task = checklist ? "Checklist: marked MIQs → quick pass earlier MIQs → revision videos → Mock 3 → re-check RTP" : `${topic} — revision video + ${restLabel}${qLabel}`;
      const meta = checklist ? `final push at ${vSpeed}× · ${cfg.rr3.daily_hours}h/day` : `watch revision video at ${vSpeed}×`;
      days.push({ date: iso(c), weekday: wd(c), stage, stageLabel, topic: checklist ? "All topics" : topic, task, meta, sunday: isSun(c), status: "ok" });
      dayNo++;
    }
  };

  const revScope1: Scope = input.revScope1 ?? "all";
  const revScope2: Scope = input.revScope2 ?? "all";
  if (!overflow) {
    let sNo = 2;
    if (includeR1) {
      breakRow(addDays(exhaustiveEnd, 1), rr1Start, "margin before revision");
      fillRound(rr1Start, rr1End, "rr1", `Stage ${sNo++} · Revision round 1`, cfg.rr1.video_speed, false, "RTP / MTP / past papers / Mock 1", false, topicNames(revScope1));
      if (includeR2) fillRound(rr2Start, rr2End, "rr2", `Stage ${sNo++} · Revision round 2`, cfg.rr2.video_speed, false, "Mock 2", true, topicNames(revScope2));
    } else {
      breakRow(addDays(exhaustiveEnd, 1), rr3Start, "margin before final revision");
    }
    fillRound(rr3Start, rr3End, "rr3", `Stage ${sNo++} · Final revision`, cfg.rr3.video_speed, true, "", true, topicNames("all"));
  }

  const fits = !overflow && fitsChosen && start < exhaustiveDeadline;
  const tight = !fits || ratioBroken;
  let recommendedRounds: number | null = null;
  if (tight && rounds > 1) recommendedRounds = rounds - 1;

  const messages: string[] = [];
  if (startedLate) messages.push(`You're starting later than the recommended ${input.params.start_months_before_exam} months before the exam.`);
  if (scope === "skip") messages.push("Exhaustive (detailed classes) skipped — this plan is revision only.");
  if (!tight) {
    messages.push(`Fits at ${speed}× with ${rounds} revision round${rounds > 1 ? "s" : ""}${scope !== "all" && scope !== "skip" ? ` (${scope.toUpperCase()} topics)` : ""} — classes finish around ${fmtDay(exhaustiveEnd)}.`);
  } else {
    const fixes: string[] = [];
    if (recommendedSpeed) fixes.push(`watch at ${recommendedSpeed}×`);
    if (recommendedRounds) fixes.push(`do ${recommendedRounds} revision round${recommendedRounds > 1 ? "s" : ""}`);
    if (sd.exhaustive && exCap < availWorkingDays) fixes.push("give the exhaustive stage more days");
    if (scope === "all") fixes.push("narrow the exhaustive topics (A+B or A-only)");
    if (fixes.length) messages.push(`Schedule is tight${ratioBroken ? " — too little time for detailed classes vs revision" : ""}. Try: ${fixes.join(" — or — ")}.`);
    else messages.push(`Even at ${cfg.max_speed}× you're short ~${Math.round(shortfallHours)}h. Add days/hours, narrow topics, or start earlier.`);
  }

  return {
    timeline: { exhaustiveStart: iso(start), exhaustiveEnd: iso(exhaustiveEnd), rr1: [iso(rr1Start), iso(rr1End)], rr2: [iso(rr2Start), iso(rr2End)], rr3: [iso(rr3Start), iso(rr3End)] },
    feasibility: { fits, speed, recommendedSpeed, revisionRounds: rounds, recommendedRounds, requiredHours: Math.round(requiredHours), availableHours: Math.round(availableHours), shortfallHours: Math.round(shortfallHours), startedLate, messages },
    days,
    totals: { classHours: Math.round(totalClassMin / 60), revisionHours: Math.round(input.revisions.reduce((s, r) => s + r.minutes, 0) / 60), classCount: remaining.length },
  };
}
