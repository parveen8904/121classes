// Day-by-day study planner. Generates a dated plan: which class(es) to watch
// each study day, and when MCQ / descriptive / full-mock tests fall — driven by
// admin "planner config" cadence and the student's self-study hours, days off
// and holidays. Used by the planner UI and the reminder job (stored result).

export type PlanSetup = {
  source: "us" | "others";
  classes: number; // resolved class count
  tests: number;
  examDate: string; // YYYY-MM-DD
  selfStudyHours: number; // hours/day of self study
  daysOffPerWeek: number; // 0, 1 (Sun) or 2 (Sat+Sun)
  holidays: string[]; // specific YYYY-MM-DD to skip
  extras: string[]; // "YYYY-MM-DD|Label" or "Label"
};

export type PlannerConfig = {
  classMinutes: number; // avg length of one class
  mcqEveryClasses: number; // schedule an MCQ test after this many classes
  descEveryClasses: number; // schedule a descriptive test after this many classes
  mockCount: number; // number of full mock tests in the revision window
  revisionDays: number; // days reserved before the exam for revision + mocks
};

export const DEFAULT_CONFIG: PlannerConfig = {
  classMinutes: 60,
  mcqEveryClasses: 5,
  descEveryClasses: 10,
  mockCount: 3,
  revisionDays: 7,
};

export type SchedEntry = { iso: string; date: string; label: string; mock?: boolean };

const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const disp = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export function buildDayPlan(
  setup: PlanSetup,
  config: PlannerConfig,
  classTitles: string[],
  now: Date = new Date(),
): { entries: SchedEntry[]; warning?: string } {
  const examMs = Date.parse(setup.examDate);
  if (!setup.examDate || isNaN(examMs)) return { entries: [] };

  const classMinutes = config.classMinutes || 60;
  const perDay = Math.max(1, Math.floor(((setup.selfStudyHours || 2) * 60) / classMinutes));
  const mcqEvery = Math.max(1, config.mcqEveryClasses || 5);
  const descEvery = Math.max(1, config.descEveryClasses || 10);
  const mockCount = Math.max(0, config.mockCount ?? 3);
  const revisionDays = Math.max(0, config.revisionDays ?? 7);
  const classCount = setup.classes || classTitles.length || 0;
  const title = (i: number) => classTitles[i] || `Class ${i + 1}`;
  const holidays = new Set(setup.holidays || []);

  const isOff = (d: Date) => {
    if (holidays.has(iso(d))) return true;
    const wd = d.getDay();
    const off = setup.daysOffPerWeek || 0;
    if (off >= 1 && wd === 0) return true; // Sunday
    if (off >= 2 && wd === 6) return true; // Saturday
    return false;
  };

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const revisionStart = examMs - revisionDays * DAY;
  const entries: SchedEntry[] = [];

  // Study phase — assign classes day by day until done or revision window starts.
  let classIdx = 0, sinceMcq = 0, sinceDesc = 0;
  let cursor = new Date(start);
  while (cursor.getTime() < revisionStart && classIdx < classCount) {
    if (!isOff(cursor)) {
      const todays: string[] = [];
      for (let k = 0; k < perDay && classIdx < classCount; k++) { todays.push(title(classIdx)); classIdx++; sinceMcq++; sinceDesc++; }
      if (todays.length) {
        entries.push({ iso: iso(cursor), date: disp(cursor), label: `📺 Watch: ${todays.join("; ")}` });
        if (sinceMcq >= mcqEvery) { entries.push({ iso: iso(cursor), date: disp(cursor), label: "🧠 MCQ test" }); sinceMcq = 0; }
        if (sinceDesc >= descEvery) { entries.push({ iso: iso(cursor), date: disp(cursor), label: "✍️ Descriptive test" }); sinceDesc = 0; }
      }
    }
    cursor = new Date(cursor.getTime() + DAY);
  }
  const overflow = classIdx < classCount;

  // Extra work with dates the student added.
  for (const ex of setup.extras || []) {
    const [a, b] = ex.split("|").map((s) => s.trim());
    if (b && /^\d{4}-\d{2}-\d{2}$/.test(a)) entries.push({ iso: a, date: disp(new Date(a)), label: `➕ ${b}` });
  }

  // Revision + full mocks window.
  const revDays: Date[] = [];
  let rc = new Date(Math.max(revisionStart, start.getTime()));
  while (rc.getTime() <= examMs) { if (!isOff(rc)) revDays.push(new Date(rc)); rc = new Date(rc.getTime() + DAY); }
  if (revDays.length) {
    const mockDays = new Set<number>();
    for (let i = 0; i < mockCount; i++) mockDays.add(Math.min(revDays.length - 1, Math.floor(((i + 1) * revDays.length) / (mockCount + 1))));
    mockDays.add(revDays.length - 1);
    revDays.forEach((d, idx) => {
      if (mockDays.has(idx)) entries.push({ iso: iso(d), date: disp(d), label: idx === revDays.length - 1 ? "📝 FINAL FULL MOCK" : "📝 Full mock test", mock: true });
      else entries.push({ iso: iso(d), date: disp(d), label: "🔁 Revision & practice" });
    });
  }

  entries.sort((a, b) => (a.iso < b.iso ? -1 : 1));

  let warning: string | undefined;
  if (overflow) {
    const daysNeeded = Math.ceil(classCount / perDay);
    warning =
      `⚠️ At ${setup.selfStudyHours} hours/day of self study (~${perDay} class${perDay > 1 ? "es" : ""}/day), there isn't enough time to finish all ${classCount} classes before the ${revisionDays}-day revision window. ` +
      `You'd need about ${daysNeeded} study days. Increase your self-study hours, remove some days off, or start sooner — otherwise your plan runs past the exam date.`;
  }
  return { entries, warning };
}

// Entries that fall in the current week (for the weekly reminder).
export function thisWeekEntries(schedule: SchedEntry[], now: Date = new Date()): SchedEntry[] {
  const start = now.getTime();
  return schedule.filter((e) => {
    const t = new Date(e.iso).getTime();
    return t >= start - DAY && t < start + 7 * DAY;
  });
}
