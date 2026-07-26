import { createServiceClient } from "@/lib/supabase/service";

// What is going on RIGHT NOW — the founder's standing brief to the copywriter.
//
// This is the thing that was wrong before: in July the AI wrote as if the
// exams were around the corner, when students were actually still in their
// first exhaustive study of the syllabus and the attempt was two months away.
// A copywriter who does not know the date writes nonsense, however good the
// tone is. So the founder keeps four plain-English notes on the Campaigns
// page, and every generated post is written against them.

export type MarketingBrief = {
  attempt: string;    // "September 2026 attempt"
  stage: string;      // where students actually are today
  festivals: string;  // dates worth greeting, one per line
  news: string;       // what is going on in the profession
};

export const BRIEF_KEYS = {
  attempt: "marketing_attempt",
  stage: "marketing_stage",
  festivals: "marketing_festivals",
  news: "marketing_news",
} as const;

export async function loadBrief(svc = createServiceClient()): Promise<MarketingBrief> {
  const { data } = await svc.from("site_settings").select("key, value").in("key", Object.values(BRIEF_KEYS));
  const m = new Map((data ?? []).map((r) => [r.key as string, String(r.value ?? "").trim()]));
  return {
    attempt: m.get(BRIEF_KEYS.attempt) ?? "",
    stage: m.get(BRIEF_KEYS.stage) ?? "",
    festivals: m.get(BRIEF_KEYS.festivals) ?? "",
    news: m.get(BRIEF_KEYS.news) ?? "",
  };
}

// The two things the founder should never have to type: festival dates and
// what the regulators did this month. Both already arrive on their own — the
// public Indian holiday calendar, and the hourly news feed.
//
// The news feed is RAW MATERIAL for both modules, not a queue to approve.
// Publishing an item decides whether STUDENTS see it on the site; it has
// nothing to do with whether the copywriter may know about it. So every
// recent headline counts, approved or not — which is also why the rules let
// the writer draw a lesson from a headline and forbid it from asserting
// anything the headline does not itself say.
export async function autoBriefParts(svc = createServiceClient()): Promise<{ festivals: string[]; news: string[] }> {
  const { festivalCalendar, festivalsAhead, loadFestivalDays } = await import("@/lib/festivals");
  const today = new Date().toISOString().slice(0, 10);
  const in21 = new Date(Date.now() + 21 * 86400e3).toISOString().slice(0, 10);
  // His own picks first; the raw calendar only until he has made any.
  const picked = (await loadFestivalDays(svc, today, in21)).filter((f) => f.greet);
  const [cal, recent] = await Promise.all([
    picked.length ? Promise.resolve(null) : festivalCalendar(),
    svc
      .from("announcements")
      .select("title, kind, published_at")
      .gte("published_at", new Date(Date.now() - 30 * 86400e3).toISOString())
      .order("published_at", { ascending: false })
      .limit(20),
  ]);
  return {
    festivals: picked.length
      ? picked.map((f) => `${new Date(`${f.on_date}T06:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", weekday: "long" })} — ${f.name}`)
      : festivalsAhead(cal!, new Date(), 21),
    news: (recent.data ?? []).map((a) => `- ${String(a.title)}`),
  };
}

// The brief as the copywriter reads it. Empty sections say so explicitly —
// silence must not be read as licence to invent a situation.
export function briefText(b: MarketingBrief, auto?: { festivals: string[]; news: string[] }): string {
  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const festivals = [...(auto?.festivals ?? []), ...b.festivals.split("\n").map((l) => l.trim()).filter(Boolean)];
  const news = [...(auto?.news ?? []), ...b.news.split("\n").map((l) => l.trim()).filter(Boolean)];
  return (
    `Today is ${today}.\n\n` +
    `THE EXAM THEY ARE PREPARING FOR: ${b.attempt || "(not stated — do not name any attempt, month or deadline)"}\n\n` +
    `WHERE THE STUDENTS ACTUALLY ARE TODAY (this decides everything you write):\n${b.stage || "(not stated — write about studying in general and do not assume any stage)"}\n\n` +
    `FESTIVALS IN THE NEXT THREE WEEKS (greet ONLY on the exact date given, never a day early or late):\n${festivals.length ? festivals.join("\n") : "(none in this window — do not greet anyone)"}\n\n` +
    `WHAT IS GOING ON IN THE PROFESSION RIGHT NOW (headlines picked up over the last month):\n${news.length ? news.join("\n") : "(nothing on record — do not refer to any news)"}`
  );
}

// The rules that go with it. Written as instructions because the failure they
// prevent is a real one: telling a student who has not finished the syllabus
// once to "start revising", or wishing exam luck two months early.
export const BRIEF_RULES =
  "WRITE FOR TODAY. The brief below says exactly where the students are in their preparation — match it. " +
  "Do not tell someone still reading the syllabus for the first time to revise, and do not tell someone revising to start from chapter one. " +
  "Never write as though the exam is near, never count down days, never wish luck for an exam, and never name a month, date or deadline that is not in the brief. " +
  "If a festival in the brief falls on the day you are writing for, that day's community and Instagram pieces become a short, warm greeting for that festival — a greeting only, with nothing about the platform in it. Never greet on a date the brief does not give you, and never invent a festival date. " +
  "News may be mentioned only if it is in the brief. Each news line is a HEADLINE and nothing more: explain what a student should take from it, and never add a fact, figure, date, outcome or opinion that the headline itself does not contain. Never present it as breaking news, and never take a side. ";
