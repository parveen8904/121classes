import { createServiceClient } from "@/lib/supabase/service";

// THE DAY'S TOPPER IN EACH PAPER — CHOSEN AT 11:59 PM, ANNOUNCED AT 3 AM.
//
// His specification, 25 Aug 2026, and the parts of it that shape this file:
//
//   · TWO TRACKS ONLY. CA Intermediate → Advanced Accounting, and CA Final →
//     Financial Reporting. Those are the two subjects taught here, so they are
//     matched by name through the topic that owns the section.
//
//   · HIGHEST PERCENTAGE, not highest marks. A 19/20 beats a 60/100, and the
//     papers of a day are not all out of the same total.
//
//   · THE DAY IS THE DAY IT WAS RELEASED. "If a paper comes at 2 AM and it is
//     released at 4 AM it will be counted in the next day." So the window sits
//     on examiner_checked_at — the moment the student was given the result —
//     not on when the copy was written or graded.
//
//   · THE MESSAGE CARRIES NAMES AND NOTHING ELSE. No marks, no percentage, no
//     paper, and above all no phone number or email: this goes to Telegram and
//     Discord groups where anyone in the room can read it. That is why the
//     marks are not even stored on daily_toppers — a figure that does not exist
//     cannot find its way into a group chat later.

export type Track = "inter" | "final";

export const TRACK_LABEL: Record<Track, string> = {
  inter: "CA Intermediate · Advanced Accounting",
  final: "CA Final · Financial Reporting",
};

/** The subject each track is decided from, as the catalogue names them. */
const TRACK_SUBJECT: Record<Track, { course: string; subject: string }> = {
  inter: { course: "CA Intermediate", subject: "Advanced Accounting" },
  final: { course: "CA Final", subject: "Financial Reporting" },
};

export type TopperRow = { day: string; track: Track; student_id: string | null; student_name: string; announced_at: string | null };

/** The IST calendar day of an instant. */
export const istDay = (d = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** 00:00:00 → 23:59:59.999 IST of one day, as UTC instants. */
export function istDayBounds(day: string): { from: string; to: string } {
  return {
    from: new Date(`${day}T00:00:00+05:30`).toISOString(),
    to: new Date(`${day}T23:59:59.999+05:30`).toISOString(),
  };
}

type Row = {
  student_id: string | null;
  awarded_marks: number | string | null;
  total_marks: number | string | null;
  sections: { topics: { subjects: { title: string; courses: { title: string } | null } | null } | null } | null;
  profiles: { full_name: string | null } | null;
};

/**
 * Work out who topped each track on one IST day.
 *
 * Ties are settled by returning nobody rather than picking arbitrarily — see
 * the note where it happens.
 */
export async function findToppers(day: string): Promise<{ track: Track; studentId: string | null; name: string }[]> {
  const svc = createServiceClient();
  const { from, to } = istDayBounds(day);

  const { data, error } = await svc
    .from("descriptive_attempts")
    .select(
      "student_id, awarded_marks, total_marks, " +
      "sections:section_id(topics:topic_id(subjects:subject_id(title, courses:course_id(title)))), " +
      "profiles:student_id(full_name)",
    )
    .eq("review_status", "checked")
    .gte("examiner_checked_at", from)
    .lte("examiner_checked_at", to)
    .not("awarded_marks", "is", null)
    .gt("total_marks", 0);

  // A refused query is not "nobody topped today". Saying nothing is right;
  // announcing an empty day because a join failed is not.
  if (error) throw new Error(`could not read the day's checked copies: ${error.message}`);

  const rows = (data ?? []) as unknown as Row[];
  const out: { track: Track; studentId: string | null; name: string }[] = [];

  for (const track of ["inter", "final"] as Track[]) {
    const want = TRACK_SUBJECT[track];
    const mine = rows.filter((r) => {
      const subj = r.sections?.topics?.subjects;
      return subj?.title === want.subject && subj?.courses?.title === want.course;
    });
    if (!mine.length) continue;

    // Best PERCENTAGE, per student's best copy of the day.
    const best = new Map<string, { pct: number; name: string }>();
    for (const r of mine) {
      const awarded = Number(r.awarded_marks), total = Number(r.total_marks);
      if (!Number.isFinite(awarded) || !(total > 0)) continue;
      const pct = (awarded / total) * 100;
      const id = String(r.student_id ?? "");
      if (!id) continue;
      const prev = best.get(id);
      if (!prev || pct > prev.pct) best.set(id, { pct, name: String(r.profiles?.full_name ?? "").trim() });
    }
    if (!best.size) continue;

    const ranked = [...best.entries()].sort((a, b) => b[1].pct - a[1].pct);
    const topPct = ranked[0][1].pct;

    // NOBODY IS ANNOUNCED FOR SCORING NOTHING. On 19 August the day's only
    // copy scored 0%, and naming that student "today's topper" to every group
    // chat would humiliate them, not congratulate them. A day where the best
    // mark is zero simply has no topper.
    if (!(topPct > 0)) continue;
    const tied = ranked.filter(([, v]) => Math.abs(v.pct - topPct) < 0.0001);

    // A TIE IS NOT A TOPPER. Two students on the same percentage cannot be
    // separated by anything this knows, and picking whichever the sort happened
    // to put first would announce a falsehood to a room of students. Every tied
    // name goes out, which is the truth.
    const named = tied.map(([id, v]) => ({ id, name: v.name })).filter((t) => t.name);
    if (!named.length) continue;

    out.push({
      track,
      studentId: named.length === 1 ? named[0].id : null,
      name: named.map((t) => t.name).join(" and "),
    });
  }
  return out;
}

/** Freeze the day's toppers. Re-running the same day overwrites, never doubles. */
export async function recordToppers(day: string): Promise<TopperRow[]> {
  const svc = createServiceClient();
  const found = await findToppers(day);
  if (!found.length) return [];

  await svc.from("daily_toppers").upsert(
    found.map((t) => ({ day, track: t.track, student_id: t.studentId, student_name: t.name })),
    { onConflict: "day,track" },
  );
  const { data } = await svc.from("daily_toppers").select("day, track, student_id, student_name, announced_at").eq("day", day);
  return (data ?? []) as TopperRow[];
}

/**
 * The message, in his words: "just tell today's toppers in inter and final".
 * No marks, no percentage, no paper name, no contact details.
 */
export function toppersMessage(rows: { track: Track; student_name: string }[], day: string): string {
  const on = new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", timeZone: "Asia/Kolkata",
  });
  const line = (t: Track) => {
    const r = rows.find((x) => x.track === t);
    return r ? `${TRACK_LABEL[t]} — ${r.student_name}` : null;
  };
  const lines = [line("inter"), line("final")].filter(Boolean) as string[];
  return [`🏆 Today's toppers (${on})`, "", ...lines, "", "Well done — keep going. 💪"].join("\n");
}
