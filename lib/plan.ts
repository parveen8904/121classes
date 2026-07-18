import { todayISTParts } from "./dates";
// Day-by-day study planner in THREE stages:
//   1. Exhaustive — watch classes, homework, MCQ/descriptive tests, master
//      important questions (per subject, from the AI repository).
//   2. First revision — starts the day classes finish; 25% of exhaustive time;
//      revision videos + the revision important-question list.
//   3. Second revision — 50% of first revision (~12.5% of exhaustive time);
//      finishes ~5 days before the exam; the student's marked questions (or the
//      revision list as a fallback).
//   + optional extra revision — like the first revision but forced to 15% of
//      exhaustive time, revision videos at a fast pace.
// If everything can't fit before the exam we DON'T silently squeeze — we raise
// the assumed study hours/day and tell the student frankly they're short of time.

export type Stage = "exhaustive" | "rev1" | "extra" | "rev2";

export type PlanSetup = {
  source: "us" | "others";
  classes: number; // resolved class count
  tests: number;
  examDate: string; // YYYY-MM-DD
  selfStudyHours: number; // hours/day of self study
  daysOffPerWeek: number; // 0, 1 (Sun) or 2 (Sat+Sun)
  holidays: string[]; // specific YYYY-MM-DD to skip
  extras: string[]; // "YYYY-MM-DD|Label" or "Label"
  wantExtraRevision?: boolean; // add the optional 3rd (extra) revision pass
};

export type PlannerConfig = {
  classMinutes: number; // avg length of one class
  mcqEveryClasses: number; // schedule an MCQ test after this many classes
  descEveryClasses: number; // schedule a descriptive test after this many classes
  mockCount: number; // number of full mock tests in the second revision
  revisionDays: number; // final buffer days kept free before the exam (stop date)
};

export const DEFAULT_CONFIG: PlannerConfig = {
  classMinutes: 60,
  mcqEveryClasses: 5,
  descEveryClasses: 10,
  mockCount: 3,
  revisionDays: 5,
};

// A single dated row. `label` is a human one-liner (used by reminders / the
// dashboard card); the typed columns drive the planner table.
export type SchedEntry = {
  iso: string;
  date: string;
  label: string;
  stage?: Stage;
  topic?: string; // column: topic / class
  topicIds?: string[]; // class ids covered (for pace / done-tracking)
  hours?: number; // column: hours
  test?: string; // column: test (MCQ / Descriptive / Full mock)
  questions?: string; // column: questions to do
  mock?: boolean;
};

export type BuildOpts = {
  classSubjects?: string[]; // subject title per class (aligned to classTitles)
  classIds?: string[]; // class/topic id per class
  subjectMaster?: Record<string, number>; // master-question count per subject
  subjectRev?: Record<string, number>; // revision-question count per subject
};

const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const disp = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildDayPlan(
  setup: PlanSetup,
  config: PlannerConfig,
  classTitles: string[],
  now: Date = new Date(),
  classDurations: number[] = [],
  opts: BuildOpts = {},
): { entries: SchedEntry[]; warning?: string; assumedHours?: number } {
  const examMs = Date.parse(setup.examDate);
  if (!setup.examDate || isNaN(examMs)) return { entries: [] };

  const classMinutes = config.classMinutes || 60;
  const enteredDaily = Math.max(classMinutes, (setup.selfStudyHours || 2) * 60);
  const durOf = (i: number) => classDurations[i] || classMinutes;
  const mcqEvery = Math.max(1, config.mcqEveryClasses || 5);
  const descEvery = Math.max(1, config.descEveryClasses || 10);
  const mockCount = Math.max(0, config.mockCount ?? 3);
  const bufferDays = Math.max(0, config.revisionDays ?? 5);
  const classCount = setup.classes || classTitles.length || 0;
  const wantExtra = !!setup.wantExtraRevision;
  const title = (i: number) => classTitles[i] || `Class ${i + 1}`;
  const subjOf = (i: number) => opts.classSubjects?.[i] || "";
  const idOf = (i: number) => opts.classIds?.[i] || "";
  const holidays = new Set(setup.holidays || []);

  const isOff = (d: Date) => {
    if (holidays.has(iso(d))) return true;
    const wd = d.getDay();
    const off = setup.daysOffPerWeek || 0;
    if (off >= 1 && wd === 0) return true; // Sunday
    if (off >= 2 && wd === 6) return true; // Saturday
    return false;
  };

  const ist = todayISTParts(); // Indian today — server clock is UTC
  const start = new Date(ist.y, ist.m - 1, ist.d);
  // The last revision is the final `bufferDays` (default 5) days before the exam.
  // Everything else must finish before it starts.
  const lastRevStart = new Date(examMs - bufferDays * DAY);

  // Non-off study days available between today and the start of the last revision.
  let studyDaysAvail = 0;
  for (let d = new Date(start); d.getTime() < lastRevStart.getTime(); d = new Date(d.getTime() + DAY)) {
    if (!isOff(d)) studyDaysAvail++;
  }

  // Total exhaustive workload, in minutes.
  let totalMin = 0;
  for (let i = 0; i < classCount; i++) totalMin += durOf(i);

  // Stage sizing. The exhaustive stage + revisions before the last one must fit
  // before the last revision starts. F = exhaustive(1) + first revision(0.25) +
  // optional extra(0.15). The last revision is a fixed window (bufferDays).
  const F = 1 + 0.25 + (wantExtra ? 0.15 : 0);
  let dailyMinutes = enteredDaily;
  let E = totalMin > 0 ? Math.ceil(totalMin / dailyMinutes) : 0;
  let warning: string | undefined;
  let assumedHours: number | undefined;

  if (totalMin > 0 && studyDaysAvail > 0 && Math.ceil(E * F) > studyDaysAvail) {
    // Short of time: keep the stage structure, raise the assumed hours/day.
    E = Math.max(1, Math.floor(studyDaysAvail / F));
    dailyMinutes = Math.ceil(totalMin / E);
    assumedHours = r1(dailyMinutes / 60);
    warning =
      `⚠️ You're short of time. To finish everything (classes + first revision${wantExtra ? " + your extra revision" : ""}) before the last revision begins (${bufferDays} days before your exam), ` +
      `this plan assumes about ${assumedHours} hours of study per day — more than the ${setup.selfStudyHours} you entered. ` +
      `If that isn't realistic, start sooner, take fewer days off, or drop the extra revision.`;
  }

  const rev1Days = E > 0 ? Math.ceil(0.25 * E) : 0;
  const extraDays = wantExtra && E > 0 ? Math.ceil(0.15 * E) : 0;

  // Master-question allocation per class (split each subject's list across its
  // classes, numbered within the subject).
  const masterByClass = new Array(classCount).fill(0);
  const qStartByClass = new Array(classCount).fill(0);
  const subjClasses = new Map<string, number[]>();
  for (let i = 0; i < classCount; i++) {
    const s = subjOf(i);
    if (!subjClasses.has(s)) subjClasses.set(s, []);
    subjClasses.get(s)!.push(i);
  }
  for (const [s, idxs] of subjClasses) {
    const total = (opts.subjectMaster || {})[s] || 0;
    if (!total || !idxs.length) continue;
    const per = Math.ceil(total / idxs.length);
    let acc = 0;
    for (const i of idxs) {
      const cnt = Math.min(per, Math.max(0, total - acc));
      masterByClass[i] = cnt;
      qStartByClass[i] = acc;
      acc += cnt;
    }
  }

  // Subjects in first-appearance order (for revision rotation).
  const subjectOrder: string[] = [];
  for (let i = 0; i < classCount; i++) {
    const s = subjOf(i) || "Full syllabus";
    if (!subjectOrder.includes(s)) subjectOrder.push(s);
  }
  if (!subjectOrder.length) subjectOrder.push("Full syllabus");

  const dailyHoursDisp = r1(dailyMinutes / 60);
  const entries: SchedEntry[] = [];
  let cursor = new Date(start);

  // ---- Stage 1: exhaustive ----
  let classIdx = 0, sinceMcq = 0, sinceDesc = 0;
  while (classIdx < classCount && cursor.getTime() < lastRevStart.getTime()) {
    if (!isOff(cursor)) {
      const todays: number[] = [];
      const qParts: string[] = [];
      let dayMin = 0;
      while (classIdx < classCount) {
        const dur = durOf(classIdx);
        if (todays.length > 0 && dayMin + dur > dailyMinutes) break;
        todays.push(classIdx);
        dayMin += dur;
        const cnt = masterByClass[classIdx] || 0;
        if (cnt > 0) {
          const a = qStartByClass[classIdx] + 1, b = qStartByClass[classIdx] + cnt;
          const sp = subjOf(classIdx) ? `${subjOf(classIdx)} ` : "";
          qParts.push(`${sp}Q${a}${b > a ? `–Q${b}` : ""}`);
        }
        classIdx++; sinceMcq++; sinceDesc++;
      }
      if (todays.length) {
        const topicLabel = todays.map((i) => title(i)).join("; ");
        let test = "";
        if (sinceMcq >= mcqEvery) { test = "MCQ test"; sinceMcq = 0; }
        if (sinceDesc >= descEvery) { test = test ? `${test} + Descriptive` : "Descriptive test"; sinceDesc = 0; }
        const questions = qParts.length ? `📌 ${qParts.join("; ")}` : "";
        const hours = r1(dayMin / 60);
        entries.push({
          iso: iso(cursor), date: disp(cursor), stage: "exhaustive",
          topic: topicLabel, topicIds: todays.map((i) => idOf(i)).filter(Boolean),
          hours, test, questions,
          label: `📺 ${topicLabel} — ${hours}h${test ? ` · ${test}` : ""}${questions ? ` · ${questions}` : ""}`,
        });
      }
    }
    cursor = new Date(cursor.getTime() + DAY);
  }
  const overflow = classIdx < classCount;

  // Helper: advance the cursor to the next non-off day.
  const nextOpenDay = () => { while (isOff(cursor)) cursor = new Date(cursor.getTime() + DAY); };

  // ---- Stage 2: first revision ----
  for (let k = 0; k < rev1Days && cursor.getTime() < lastRevStart.getTime(); k++) {
    nextOpenDay();
    const s = subjectOrder[k % subjectOrder.length];
    const revCount = (opts.subjectRev || {})[s] || 0;
    const test = (k + 1) % 3 === 0 ? "MCQ test" : "";
    const questions = revCount ? `🔁 Revision Qs: ${s}` : "🔁 Revision questions";
    entries.push({
      iso: iso(cursor), date: disp(cursor), stage: "rev1",
      topic: `🔁 Revision video: ${s}`, hours: dailyHoursDisp, test, questions,
      label: `🔁 First revision — ${s} (${dailyHoursDisp}h)${test ? ` · ${test}` : ""} · ${questions}`,
    });
    cursor = new Date(cursor.getTime() + DAY);
  }

  // ---- Optional extra revision (fast pace) ----
  for (let k = 0; k < extraDays && cursor.getTime() < lastRevStart.getTime(); k++) {
    nextOpenDay();
    const s = subjectOrder[k % subjectOrder.length];
    entries.push({
      iso: iso(cursor), date: disp(cursor), stage: "extra",
      topic: `⚡ Fast revision: ${s}`, hours: dailyHoursDisp, test: "",
      questions: "⚡ Revision questions (high-weight)",
      label: `⚡ Extra revision (fast) — ${s} (${dailyHoursDisp}h)`,
    });
    cursor = new Date(cursor.getTime() + DAY);
  }

  // ---- Last revision: the final `bufferDays` days before the exam ----
  // Dedicated to the student's must-do questions (added per sub-topic in the
  // planner), with full mocks interspersed. The actual questions are overlaid
  // by the UI; here we lay out the day skeletons.
  if (cursor.getTime() < lastRevStart.getTime()) cursor = new Date(lastRevStart.getTime());
  const revDates: Date[] = [];
  while (cursor.getTime() < examMs) {
    if (!isOff(cursor)) revDates.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + DAY);
  }
  const lastIdx = revDates.length - 1;
  const mocks = new Set<number>();
  if (revDates.length) {
    for (let i = 0; i < mockCount; i++) mocks.add(Math.min(lastIdx, Math.floor(((i + 1) * revDates.length) / (mockCount + 1))));
    mocks.add(lastIdx); // final mock on the last day
  }
  revDates.forEach((d, k) => {
    if (mocks.has(k)) {
      const last = k === lastIdx;
      entries.push({
        iso: iso(d), date: disp(d), stage: "rev2", mock: true,
        topic: last ? "📝 Final full mock" : "📝 Full mock test", hours: dailyHoursDisp,
        test: last ? "Final mock" : "Full mock", questions: "Your must-do questions",
        label: last ? "📝 FINAL FULL MOCK" : "📝 Full mock test",
      });
    } else {
      entries.push({
        iso: iso(d), date: disp(d), stage: "rev2",
        topic: "🔂 Last revision — your must-do questions", hours: dailyHoursDisp, test: "",
        questions: "Your must-do questions",
        label: `🔂 Last revision — your must-do questions (${dailyHoursDisp}h)`,
      });
    }
  });

  // Student's dated extra work.
  for (const ex of setup.extras || []) {
    const [a, b] = ex.split("|").map((s) => s.trim());
    if (b && /^\d{4}-\d{2}-\d{2}$/.test(a)) {
      entries.push({ iso: a, date: disp(new Date(a)), label: `➕ ${b}`, topic: `➕ ${b}` });
    }
  }

  entries.sort((a, b) => (a.iso < b.iso ? -1 : 1));

  if (overflow && !warning) {
    const daysNeeded = Math.ceil(totalMin / dailyMinutes);
    warning =
      `⚠️ At ${setup.selfStudyHours} hours/day, there isn't enough time to finish all ${classCount} classes ` +
      `(~${Math.round(totalMin / 60)} hrs) before your exam. You'd need about ${daysNeeded} study days. ` +
      `Increase your self-study hours, take fewer days off, or start sooner.`;
  }

  return { entries, warning, assumedHours };
}

// Entries that fall in the current week (for the weekly reminder).
export function thisWeekEntries(schedule: SchedEntry[], now: Date = new Date()): SchedEntry[] {
  const start = now.getTime();
  return schedule.filter((e) => {
    const t = new Date(e.iso).getTime();
    return t >= start - DAY && t < start + 7 * DAY;
  });
}
