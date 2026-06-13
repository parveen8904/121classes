"use client";

import { useState } from "react";
import { DURATIONS, durationLabel } from "@/lib/pricing";

type Subject = { id: string; title: string };
type Course = { id: string; title: string; subjects: Subject[] };

const TIERS = [
  { value: "bronze", label: "🥉 Bronze" },
  { value: "silver", label: "🥈 Silver" },
  { value: "gold", label: "🥇 Gold" },
];

export default function EnrolForm({
  courses,
  action,
  mode,
}: {
  courses: Course[];
  action: (formData: FormData) => void | Promise<void>;
  mode: "single" | "bulk";
}) {
  const [courseId, setCourseId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const subjects = courses.find((c) => c.id === courseId)?.subjects ?? [];

  return (
    <form action={action}>
      {mode === "single" ? (
        <>
          <label>Student email</label>
          <input name="email" type="email" placeholder="student@example.com" required />
        </>
      ) : (
        <>
          <label>Emails (comma, space or newline separated)</label>
          <textarea name="emails" rows={4} placeholder="a@x.com, b@y.com…" required />
        </>
      )}

      <label>Course</label>
      <select
        name="course_id"
        required
        value={courseId}
        onChange={(e) => {
          setCourseId(e.target.value);
          setSubjectId("");
        }}
      >
        <option value="" disabled>
          Select course…
        </option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>

      <label>Subject</label>
      <select name="subject_id" required value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!courseId}>
        <option value="" disabled>
          {courseId ? "Select subject…" : "Pick a course first"}
        </option>
        <option value="all">🎓 Whole course (all subjects)</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label>Tier</label>
          <select name="tier" defaultValue="bronze">
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Duration</label>
          <select name="months" defaultValue="3">
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button className="btn" type="submit">
        {mode === "single" ? "Grant access" : "Grant to all"}
      </button>
    </form>
  );
}
