type Course = { id: string; title: string };

// Profile: choose ONE course (your level). Subjects are picked on the dashboard
// (you can only add subjects from this level).
export default function CourseSubjectsPicker({
  courses,
  currentCourseId,
}: {
  courses: Course[];
  currentCourseId: string;
}) {
  return (
    <>
      <label htmlFor="course_id">Your course / level</label>
      <select id="course_id" name="course_id" defaultValue={currentCourseId} style={{ maxWidth: 360 }}>
        <option value="">— select your level —</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>{c.title}</option>
        ))}
      </select>
      <p className="muted" style={{ fontSize: ".8rem", margin: "6px 0 0" }}>
        Pick your level here. You then add the <strong>subjects</strong> you&apos;ve opted for on your dashboard — and you can only add subjects from this level.
      </p>
    </>
  );
}
