"use client";

import { useState } from "react";

type Course = { id: string; title: string };
type Subject = { id: string; title: string; course_id: string };

// Profile picker: choose ONE course (your level), then tick the subjects you've
// opted for. You can only pick subjects from your chosen level.
export default function CourseSubjectsPicker({
  courses,
  subjects,
  currentCourseId,
  currentSubjectIds,
}: {
  courses: Course[];
  subjects: Subject[];
  currentCourseId: string;
  currentSubjectIds: string[];
}) {
  const [courseId, setCourseId] = useState(currentCourseId);
  const subs = subjects.filter((s) => s.course_id === courseId);
  const checked = new Set(currentSubjectIds);

  return (
    <>
      <label htmlFor="course_id">Your course / level</label>
      <select id="course_id" name="course_id" value={courseId} onChange={(e) => setCourseId(e.target.value)} style={{ maxWidth: 360 }}>
        <option value="">— select your level —</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>{c.title}</option>
        ))}
      </select>
      <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 12px" }}>
        You can only add subjects from your own level (e.g. a CA Intermediate student can&apos;t add CA Final subjects).
      </p>

      <label>Subjects you&apos;ve opted for</label>
      {courseId ? (
        subs.length > 0 ? (
          <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
            {subs.map((s) => (
              <label key={s.id} className="remember" style={{ margin: 0 }}>
                <input type="checkbox" name="subject_ids" value={s.id} defaultChecked={checked.has(s.id)} /> {s.title}
              </label>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: ".85rem" }}>No subjects in this course yet.</p>
        )
      ) : (
        <p className="muted" style={{ fontSize: ".85rem" }}>Pick your level above to see its subjects.</p>
      )}
    </>
  );
}
