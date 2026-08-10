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

export const ACTIVITIES = [
  { key: "classes_done",     label: "Classes finished",        icon: "🎬" },
  { key: "revisions_done",   label: "Revision classes",        icon: "🔁" },
  { key: "mcq_done",         label: "MCQ tests",               icon: "✅" },
  { key: "cases_done",       label: "Case scenarios",          icon: "🧩" },
  { key: "mock_done",        label: "Mock papers",             icon: "📄" },
  { key: "descriptive_done", label: "Descriptive papers",      icon: "✍️" },
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
