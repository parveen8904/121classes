// Shared study-plan scheduling — used by the planner UI (client) AND the
// reminder job (server), so what a student sees and what we remind match exactly.

export type PlanSetup = {
  source: "us" | "others";
  classes: number; // resolved class count
  tests: number;
  examDate: string; // YYYY-MM-DD
};

export type SchedEntry = { iso: string; date: string; label: string; mock?: boolean };

const WEEK = 7 * 86400000;

export function buildSchedule(setup: PlanSetup, now: Date = new Date()): SchedEntry[] {
  if (!setup.examDate) return [];
  const exam = new Date(setup.examDate);
  const weeks = Math.max(1, Math.ceil((exam.getTime() - now.getTime()) / WEEK));
  const revisionWeeks = Math.min(3, Math.max(1, Math.floor(weeks * 0.2)));
  const studyWeeks = Math.max(1, weeks - revisionWeeks);
  const classes = setup.classes || studyWeeks;
  const tests = setup.tests || Math.max(1, Math.round(classes / 5));
  const cpw = Math.ceil(classes / studyWeeks);
  const tpw = Math.max(1, Math.ceil(tests / studyWeeks));

  const at = (w: number) => new Date(now.getTime() + (w - 1) * WEEK);
  const disp = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const mockWeeks = new Set([Math.max(2, Math.floor(studyWeeks * 0.5)), Math.max(3, Math.floor(studyWeeks * 0.8))]);

  const out: SchedEntry[] = [];
  for (let w = 1; w <= studyWeeks; w++) {
    const d = at(w);
    out.push({ iso: iso(d), date: disp(d), label: `Week ${w}: ${cpw} class${cpw > 1 ? "es" : ""} · ${tpw} test${tpw > 1 ? "s" : ""}` });
    if (mockWeeks.has(w)) out.push({ iso: iso(d), date: disp(d), label: "📝 MOCK FULL EXAM", mock: true });
  }
  for (let r = 1; r <= revisionWeeks; r++) {
    const d = at(studyWeeks + r);
    out.push({
      iso: iso(d),
      date: disp(d),
      label: r === revisionWeeks ? "📝 FINAL FULL MOCK + full revision" : "🔁 Revision & question practice",
      mock: r === revisionWeeks,
    });
  }
  return out;
}

// The plan entries that fall in the current week (for "this week" reminders).
export function thisWeekEntries(schedule: SchedEntry[], now: Date = new Date()): SchedEntry[] {
  const start = now.getTime();
  const end = start + WEEK;
  return schedule.filter((e) => {
    const t = new Date(e.iso).getTime();
    return t >= start - WEEK && t < end; // current + just-started week
  });
}
