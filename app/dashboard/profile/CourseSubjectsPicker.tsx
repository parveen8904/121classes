"use client";

import { useState } from "react";

type Course = { id: string; title: string };

// Profile: choose ONE course (your level). Subjects are picked on the dashboard.
// Changing AWAY from an existing level asks for confirmation TWICE (with a data-loss
// warning) so students don't change it by accident.
export default function CourseSubjectsPicker({
  courses,
  currentCourseId,
}: {
  courses: Course[];
  currentCourseId: string;
}) {
  const [courseId, setCourseId] = useState(currentCourseId);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === courseId) return;

    // First-time selection (no current level) is free. Changing an existing level
    // requires a double confirmation.
    if (currentCourseId && next !== currentCourseId) {
      const ok1 = window.confirm(
        "⚠️ Are you sure you want to CHANGE YOUR LEVEL?\n\n" +
          "Changing your level may lead to LOSS of your data — the classes you have watched, your inbox, doubts and test reports. " +
          "We strongly recommend NOT changing it.\n\nDo you want to continue?",
      );
      if (!ok1) return; // keep current level
      const ok2 = window.confirm(
        "Please CONFIRM AGAIN.\n\n" +
          "By continuing you AGREE to the Terms & Conditions and accept that changing your level may cause data loss.\n\nProceed with the change?",
      );
      if (!ok2) return;
    }
    setCourseId(next);
  }

  return (
    <>
      <label htmlFor="course_id">Your course / level</label>
      <select id="course_id" name="course_id" value={courseId} onChange={onChange} style={{ maxWidth: 360 }}>
        <option value="">— select your level —</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>{c.title}</option>
        ))}
      </select>
      <p className="muted" style={{ fontSize: ".8rem", margin: "6px 0 0" }}>
        Pick your level here. You then add the <strong>subjects</strong> you&apos;ve opted for on your dashboard — you can only add subjects from this level.
      </p>
      {currentCourseId && (
        <p style={{ fontSize: ".8rem", margin: "8px 0 0", color: "#dc2626", fontWeight: 700 }}>
          ⚠️ Changing your level is not recommended — it may lead to loss of your data. Only change it if you really mean to.
        </p>
      )}
    </>
  );
}
