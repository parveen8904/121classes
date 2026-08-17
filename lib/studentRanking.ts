// WHO IS ACTUALLY WORKING, AND HOW HARD.
//
// The founder wants to find the students worth mentoring, in each course, on
// what the site can actually see. He set the weights himself:
//
//   Classes watched      50
//   Revisions            15
//   Mock & descriptive   25
//   Case studies & MCQ   10
//
// Two decisions worth stating, because they change who comes top:
//
// EFFORT IS MEASURED AGAINST WHAT IS AVAILABLE, not against other students. A
// student who has finished 50 of 156 classes scores the same whether the rest
// of the cohort has done 5 or 500. A curve would make the ranking move when
// somebody else studies, which is not something this founder can act on.
//
// TESTS COUNT FOR DOING THEM *AND* FOR DOING THEM WELL. Classes and revisions
// are pure attendance — you cannot watch a class "well". A test has a mark, and
// somebody who attempts every paper and scores 20% is not a student to hold up
// as an example. So those two components are coverage multiplied by accuracy.
//
// Where a paper has been submitted but not yet marked, accuracy is treated as
// full rather than zero: the queue is ours, and a student should not slip down
// the list because we have not got to their copy.
//
// AND THE ONE THAT MADE THE FIRST VERSION OF THIS WORTHLESS. A class becomes
// "completed" two ways: the player runs 90% of the video, or the student ticks
// it off on their planner — which exists for classes watched elsewhere. 243 of
// the first 268 completed rows had ZERO seconds played, and one student ticked
// fifty classes in six minutes and led the ranking. So only PLAYED classes
// count here. The ticks are still shown, because a student saying "I did these
// elsewhere" is telling you something — but it is a claim, not evidence, and it
// is never added to the score.

export const WEIGHTS = {
  classes: 50,
  revisions: 15,
  tests: 25,      // mock + descriptive
  practice: 10,   // case scenarios + MCQ
} as const;

/** One row of public.student_effort. */
export type Effort = {
  student_id: string;
  course_id: string;
  classes_done: number; classes_total: number;
  revisions_done: number; revisions_total: number;
  /** Ticked off on the planner with nothing played. A claim, not evidence. */
  classes_ticked: number; revisions_ticked: number;
  /** Hours of video that actually ran. The least arguable number here. */
  watch_hours: number;
  mcq_score: number; mcq_marks: number;
  case_score: number; case_marks: number;
  tests_marked: number;
  mcq_done: number; mcq_total: number;
  cases_done: number; cases_total: number;
  tests_done: number; tests_total: number;
  mock_done: number; descriptive_done: number;
  practice_score: number; practice_marks: number;
  test_score: number; test_marks: number;
};

export type Scored = {
  student_id: string;
  course_id: string;
  /** Out of 100. */
  total: number;
  parts: { classes: number; revisions: number; tests: number; practice: number };
  /** The plain numbers behind the score, for showing beside it. */
  shown: {
    classes: string; revisions: string; tests: string; practice: string;
    ticked: number; hours: number;
    testAccuracy: number | null; practiceAccuracy: number | null;
  };
};

const share = (done: number, total: number) => (total > 0 ? Math.min(1, done / total) : 0);

/**
 * Accuracy as a fraction, or null when nothing has been marked yet.
 * Null is treated as full credit by the caller — see the note at the top.
 */
function accuracy(score: number, marks: number): number | null {
  if (!marks || marks <= 0) return null;
  return Math.max(0, Math.min(1, score / marks));
}

export function scoreEffort(e: Effort): Scored {
  const classes = share(e.classes_done, e.classes_total) * WEIGHTS.classes;
  const revisions = share(e.revisions_done, e.revisions_total) * WEIGHTS.revisions;

  const testAcc = accuracy(e.test_score, e.test_marks);
  const tests = share(e.tests_done, e.tests_total) * (testAcc ?? 1) * WEIGHTS.tests;

  const practiceDone = e.mcq_done + e.cases_done;
  const practiceTotal = e.mcq_total + e.cases_total;
  const practiceAcc = accuracy(e.practice_score, e.practice_marks);
  const practice = share(practiceDone, practiceTotal) * (practiceAcc ?? 1) * WEIGHTS.practice;

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    student_id: e.student_id,
    course_id: e.course_id,
    total: round(classes + revisions + tests + practice),
    parts: { classes: round(classes), revisions: round(revisions), tests: round(tests), practice: round(practice) },
    shown: {
      classes: `${e.classes_done}/${e.classes_total}`,
      ticked: e.classes_ticked + e.revisions_ticked,
      hours: e.watch_hours,
      revisions: `${e.revisions_done}/${e.revisions_total}`,
      tests: `${e.tests_done}/${e.tests_total}`,
      practice: `${practiceDone}/${practiceTotal}`,
      testAccuracy: testAcc,
      practiceAccuracy: practiceAcc,
    },
  };
}

/** Highest first. Ties broken by classes, because that is the heaviest thing. */
export function rank(rows: Effort[]): Scored[] {
  return rows
    .map(scoreEffort)
    .sort((a, b) => b.total - a.total || b.parts.classes - a.parts.classes);
}

// ── THE PLAIN LISTS ────────────────────────────────────────────────────────
//
// A weighted score answers "who should I mentor". It does not answer "who has
// watched the most classes", and those are different questions: a student who
// has sat every case study and no classes is invisible in the first and top of
// the fourth. So the same numbers are also offered raw, one list per activity,
// no arithmetic in between — nothing to argue with.

/**
 * A board is one question with one answer: who leads on this?
 *
 * `value` is what it ranks by; `caption` is what the row says next to a name.
 * Marks boards rank on PERCENTAGE, not on the raw total — a student who sat two
 * papers and scored 22 of 40 is ahead of one who sat five and scored 30 of 100,
 * and only a percentage says so.
 */
export type Board = {
  key: string;
  label: string;
  icon: string;
  value: (e: Effort) => number;
  caption: (e: Effort) => string;
  /** Ranking on a percentage needs a floor, or one lucky 5/5 wins for ever. */
  minMarks?: number;
};

export const BOARDS: Board[] = [
  {
    key: "classes", label: "Classes completed", icon: "🎬",
    value: (e) => e.classes_done,
    caption: (e) => `${e.classes_done} of ${e.classes_total} played · ${e.watch_hours}h watched`,
  },
  {
    key: "planner", label: "Planner — marked done", icon: "☑️",
    // The student's own tick. Not proof they watched it here, but it IS their
    // account of their own progress, and that is worth its own board rather
    // than being quietly mixed into the class figures.
    value: (e) => e.classes_ticked + e.revisions_ticked,
    caption: (e) => `${e.classes_ticked + e.revisions_ticked} ticked off on their planner`,
  },
  {
    key: "mock", label: "Mock papers given", icon: "📄",
    value: (e) => e.mock_done,
    caption: (e) => `${e.mock_done} mock paper${e.mock_done === 1 ? "" : "s"} submitted`,
  },
  {
    key: "descriptive", label: "Descriptive papers submitted", icon: "✍️",
    value: (e) => e.descriptive_done,
    caption: (e) => `${e.descriptive_done} paper${e.descriptive_done === 1 ? "" : "s"} submitted`,
  },
  {
    key: "marks", label: "Marks in written papers", icon: "🎯",
    value: (e) => (e.test_marks > 0 ? (e.test_score / e.test_marks) * 100 : 0),
    caption: (e) =>
      `${e.test_score} of ${e.test_marks} — ${Math.round((e.test_score / (e.test_marks || 1)) * 100)}%` +
      ` across ${e.tests_marked} marked paper${e.tests_marked === 1 ? "" : "s"}`,
    // 15, not 20. The floor exists to stop a single lucky 5-mark exercise
    // topping a percentage board — but the chapter tests here are written out of
    // 17 to 20 marks, so a floor of 20 quietly excluded any student whose one
    // marked paper was out of 17. Krishi Bhatia scored 13 of 17, a real paper
    // marked by an examiner, and did not appear on the board at all.
    minMarks: 15,
  },
  {
    key: "cases", label: "Case study toppers", icon: "🧩",
    value: (e) => (e.case_marks > 0 ? (e.case_score / e.case_marks) * 100 : 0),
    caption: (e) =>
      `${e.case_score} of ${e.case_marks} — ${Math.round((e.case_score / (e.case_marks || 1)) * 100)}%` +
      ` across ${e.cases_done} scenario${e.cases_done === 1 ? "" : "s"}`,
    minMarks: 10,
  },
  {
    key: "mcq", label: "MCQ toppers", icon: "✅",
    value: (e) => (e.mcq_marks > 0 ? (e.mcq_score / e.mcq_marks) * 100 : 0),
    caption: (e) =>
      `${e.mcq_score} of ${e.mcq_marks} — ${Math.round((e.mcq_score / (e.mcq_marks || 1)) * 100)}%` +
      ` across ${e.mcq_done} test${e.mcq_done === 1 ? "" : "s"}`,
    minMarks: 10,
  },
];

/** The rows on one board, best first. Anybody on nought is left off it. */
export function boardRows(rows: Effort[], b: Board): Effort[] {
  return rows
    .filter((e) => {
      if (b.value(e) <= 0) return false;
      // A percentage board needs enough marks behind it to mean anything.
      if (b.minMarks) {
        const marks = b.key === "marks" ? e.test_marks : b.key === "cases" ? e.case_marks : e.mcq_marks;
        if (marks < b.minMarks) return false;
      }
      return true;
    })
    .sort((x, y) => b.value(y) - b.value(x) || y.watch_hours - x.watch_hours);
}

export const ACTIVITIES = [
  { key: "watch_hours",      label: "Hours of video watched",  icon: "⏱️" },
  { key: "classes_done",     label: "Classes played through",  icon: "🎬" },
  { key: "revisions_done",   label: "Revision classes played", icon: "🔁" },
  { key: "mcq_done",         label: "MCQ tests",               icon: "✅" },
  { key: "cases_done",       label: "Case scenarios",          icon: "🧩" },
  { key: "mock_done",        label: "Mock papers",             icon: "📄" },
  { key: "descriptive_done", label: "Descriptive papers",      icon: "✍️" },
  // Shown last and named for what it is, so nobody reads it as study.
  { key: "classes_ticked",   label: "Classes ticked as done (not played here)", icon: "☑️" },
] as const;

export type ActivityKey = (typeof ACTIVITIES)[number]["key"];

/**
 * The top `n` for one activity, across both courses.
 *
 * Anyone on nought is left out entirely: a list of fifty where forty are zero
 * is not a leaderboard, it is a list of everybody.
 */
export function topBy(rows: Effort[], key: ActivityKey, n: number): Effort[] {
  return rows
    .filter((r) => Number(r[key]) > 0)
    .sort((a, b) => Number(b[key]) - Number(a[key]) || b.classes_done - a.classes_done)
    .slice(0, n);
}
