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

/**
 * THE NAME THAT MAY BE READ OUT LOUD.
 *
 * A student's stored full_name is whatever they typed at signup, and some of it
 * is not a name. One real profile reads "Anjali Anjali 9355804741" — the girl's
 * own phone number, sitting in the field this announcement was about to send to
 * every Telegram and Discord group. His rule is explicit: do not share phone
 * numbers or emails. So the name is cleaned before it can ever be posted:
 *
 *   · any run of six or more digits goes (phone numbers, enrolment ids),
 *   · anything with an @ goes (an email pasted into the name box),
 *   · a word immediately repeated is collapsed ("Anjali Anjali" → "Anjali"),
 *   · and if what is left is not a plausible name, NOBODY is announced for
 *     that track. Silence is the safe failure here; a mangled or revealing
 *     name in a room of students is not.
 */
export function publicName(raw: string | null | undefined): string {
  let n = String(raw ?? "");
  if (n.includes("@")) n = n.replace(/\S+@\S+/g, " ");
  n = n.replace(/\d[\d\s-]{4,}\d/g, " ");   // 6+ digits, however spaced
  n = n.replace(/[^\p{L}\s.'-]/gu, " ");     // keep letters and name punctuation
  n = n.replace(/\s+/g, " ").trim();

  const words = n.split(" ").filter(Boolean);
  const deduped: string[] = [];
  for (const w of words) {
    if (!deduped.length || deduped[deduped.length - 1].toLowerCase() !== w.toLowerCase()) deduped.push(w);
  }
  const out = deduped.join(" ");
  // Two letters is the shortest thing that could be a name; below that, or all
  // punctuation, and we say nothing rather than something wrong.
  return /\p{L}{2,}/u.test(out) ? out : "";
}

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

  // THE NAME IS FETCHED SEPARATELY, NOT EMBEDDED.
  //
  // descriptive_attempts.student_id carries NO foreign key — only examiner_id,
  // section_id and mock_paper_id do — so PostgREST cannot embed profiles
  // through it and the whole query was refused: "Could not find a relationship
  // between 'descriptive_attempts' and 'student_id'". Adding the constraint to
  // a live table is the riskier fix (it would fail outright on any orphaned
  // row), so the ids are collected and the names looked up in a second query.
  const { data, error } = await svc
    .from("descriptive_attempts")
    .select(
      "student_id, awarded_marks, total_marks, " +
      "sections:section_id(topics:topic_id(subjects:subject_id(title, courses:course_id(title))))",
    )
    .eq("review_status", "checked")
    .gte("examiner_checked_at", from)
    .lte("examiner_checked_at", to)
    .not("awarded_marks", "is", null)
    .gt("total_marks", 0);

  // A refused query is not "nobody topped today". Saying nothing is right;
  // announcing an empty day because a join failed is not.
  if (error) throw new Error(`could not read the day's checked copies: ${error.message}`);

  const raw = (data ?? []) as unknown as Omit<Row, "profiles">[];

  const ids = [...new Set(raw.map((r) => String(r.student_id ?? "")).filter(Boolean))];
  const names = new Map<string, string>();
  // In chunks: a long .in() list builds a URL the server refuses, and it comes
  // back as an empty column rather than an error. See lib/pageAll.ts.
  for (let i = 0; i < ids.length; i += 200) {
    const { data: people } = await svc.from("profiles").select("id, full_name").in("id", ids.slice(i, i + 200));
    for (const p of people ?? []) names.set(String(p.id), String(p.full_name ?? ""));
  }
  const rows: Row[] = raw.map((r) => ({
    ...r,
    profiles: { full_name: names.get(String(r.student_id ?? "")) ?? null },
  }));
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
      if (!prev || pct > prev.pct) best.set(id, { pct, name: publicName(r.profiles?.full_name) });
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
/**
 * THE PUSH BODY — the same facts, in the room a notification has.
 *
 * This was built separately at both send sites as just the names joined by a
 * dot, so the phone showed "Anjali · KRISHNA KUMAR" with no way to tell which
 * paper either of them topped. The long-form message had the labels all along;
 * the notification quietly dropped them because it was written twice, in two
 * files, instead of once here.
 *
 * Short labels because a lock screen gives about two lines: "CA Inter" and
 * "CA Final" are what a student of this school calls them.
 */
export function toppersPushBody(rows: { track: Track; student_name: string }[]): string {
  const short: Record<Track, string> = { inter: "CA Inter", final: "CA Final" };
  return (["inter", "final"] as Track[])
    .map((t) => {
      const r = rows.find((x) => x.track === t);
      return r ? `${short[t]}: ${r.student_name}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

export function toppersMessage(rows: { track: Track; student_name: string }[], day: string): string {
  const on = new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", timeZone: "Asia/Kolkata",
  });
  // "TODAY'S" ONLY WHEN IT IS TODAY. The nightly run always announces the day
  // that just ended, so the word is right there — but a day re-sent by hand
  // days later would tell every student that three-day-old results are
  // today's. The date was always in the line; now the wording agrees with it.
  const isToday = day === istDay();
  const heading = isToday ? `🏆 Today's toppers (${on})` : `🏆 Toppers — ${on}`;
  const line = (t: Track) => {
    const r = rows.find((x) => x.track === t);
    return r ? `${TRACK_LABEL[t]} — ${r.student_name}` : null;
  };
  const lines = [line("inter"), line("final")].filter(Boolean) as string[];
  return [heading, "", ...lines, "", "Well done — keep going. 💪"].join("\n");
}
