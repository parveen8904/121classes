import { rank, scoreEffort, WEIGHTS, type Effort } from "../lib/studentRanking";

// A LEADERBOARD THE FOUNDER WILL ACT ON HAS TO BE RIGHT.
//
// He is going to ring the people at the top of this list and offer to mentor
// them. So the weights must be the ones he set, a student who has done nothing
// must not appear above one who has, and marks must count — somebody who
// attempts every paper and scores a fifth of the marks is not the student to
// hold up as an example.

const base: Effort = {
  student_id: "s", course_id: "c",
  classes_done: 0, classes_total: 100,
  revisions_done: 0, revisions_total: 20,
  mcq_done: 0, mcq_total: 30,
  cases_done: 0, cases_total: 20,
  tests_done: 0, tests_total: 40,
  mock_done: 0, descriptive_done: 0,
  classes_ticked: 0, revisions_ticked: 0, watch_hours: 0,
  practice_score: 0, practice_marks: 0,
  test_score: 0, test_marks: 0,
};
const of = (o: Partial<Effort>): Effort => ({ ...base, ...o });

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

// ── The weights are the ones he asked for ─────────────────────────────────
check(WEIGHTS.classes === 50, "classes carry 50");
check(WEIGHTS.revisions === 15, "revisions carry 15");
check(WEIGHTS.tests === 25, "mock and descriptive carry 25");
check(WEIGHTS.practice === 10, "case studies and MCQ carry 10");
check(WEIGHTS.classes + WEIGHTS.revisions + WEIGHTS.tests + WEIGHTS.practice === 100, "and they add to 100");

// ── A perfect student ─────────────────────────────────────────────────────
const perfect = scoreEffort(of({
  classes_done: 100, revisions_done: 20, mcq_done: 30, cases_done: 20, tests_done: 40,
  practice_score: 50, practice_marks: 50, test_score: 400, test_marks: 400,
}));
check(near(perfect.total, 100), `everything done, full marks = 100 (got ${perfect.total})`);

// ── Somebody who has done nothing ─────────────────────────────────────────
check(scoreEffort(base).total === 0, "nothing done is zero, not a small number");

// ── Each component on its own ─────────────────────────────────────────────
check(near(scoreEffort(of({ classes_done: 50 })).total, 25), "half the classes is half of 50");
check(near(scoreEffort(of({ revisions_done: 20 })).total, 15), "all revisions is the full 15");
check(near(scoreEffort(of({ classes_done: 100 })).total, 50), "all classes alone cannot exceed 50");

// ── Marks matter on the tested components ─────────────────────────────────
const allTestsFullMarks = scoreEffort(of({ tests_done: 40, test_score: 400, test_marks: 400 }));
const allTestsPoorMarks = scoreEffort(of({ tests_done: 40, test_score: 80, test_marks: 400 }));
check(near(allTestsFullMarks.total, 25), "every paper at full marks is the whole 25");
check(near(allTestsPoorMarks.total, 5), "every paper at 20% is a fifth of it");
check(allTestsPoorMarks.total < allTestsFullMarks.total,
  "attempting everything badly must rank below attempting everything well");

// ── A submitted-but-unmarked paper is not punished ────────────────────────
const waiting = scoreEffort(of({ tests_done: 40, test_score: 0, test_marks: 0 }));
check(near(waiting.total, 25), "papers awaiting OUR marking count in full, not as zero");
check(waiting.shown.testAccuracy === null, "…and the screen says the accuracy is unknown rather than 0%");

// ── Nothing available means nothing owed ──────────────────────────────────
const noCourse = scoreEffort(of({ classes_total: 0, revisions_total: 0, mcq_total: 0, cases_total: 0, tests_total: 0 }));
check(noCourse.total === 0 && Number.isFinite(noCourse.total), "a course with no content scores 0, never NaN");

// ── More done than exists cannot break the cap ───────────────────────────
const overshoot = scoreEffort(of({ classes_done: 500, classes_total: 100 }));
check(near(overshoot.total, 50), "doing more classes than exist is still capped at 50");

// ── Order, and the tie-break ─────────────────────────────────────────────
const ranked = rank([
  of({ student_id: "quiet" }),
  of({ student_id: "worker", classes_done: 80, revisions_done: 10 }),
  of({ student_id: "tester", tests_done: 40, test_score: 400, test_marks: 400 }),
]);
check(ranked[0].student_id === "worker", "the one who watched 80 classes leads");
check(ranked[ranked.length - 1].student_id === "quiet", "the one who did nothing is last");

// Two equal scores are separated by classes, because that is the heaviest thing.
const tie = rank([
  of({ student_id: "byTests", tests_done: 40, test_score: 400, test_marks: 400 }),   // 25
  of({ student_id: "byClasses", classes_done: 50 }),                                  // 25
]);
check(tie[0].student_id === "byClasses", "on a tie, the one who did the classes comes first");

// ── What is shown beside the score must match what was counted ───────────
const s = scoreEffort(of({ classes_done: 7, mcq_done: 3, cases_done: 2 }));
check(s.shown.classes === "7/100", "the classes column shows done out of available");
check(s.shown.practice === "5/50", "practice adds MCQ and case studies together");

// ── TICKING IS NOT WATCHING ───────────────────────────────────────────────
// The whole first version of this report ranked on a flag that a student sets
// by tapping "done" on their planner. One of them ticked fifty classes in six
// minutes and led the list. Ticks must never reach the score.
const ticker = scoreEffort(of({ classes_ticked: 100, revisions_ticked: 20 }));
check(ticker.total === 0, "a student who ticked everything and played nothing scores zero");
check(ticker.shown.ticked === 120, "…but the ticks are still shown, so the founder can see them");

const watcher = scoreEffort(of({ classes_done: 10, watch_hours: 8 }));
check(watcher.total > 0, "a student who played ten classes scores something");
check(rank([of({ student_id: "ticker", classes_ticked: 100 }), of({ student_id: "watcher", classes_done: 3 })])[0]
  .student_id === "watcher", "three classes played beat a hundred ticked");

console.log(fails === 0 ? "PASS  student ranking: 50/15/25/10, marks count, unmarked papers not punished, no NaN" : "");
process.exit(fails === 0 ? 0 : 1);
