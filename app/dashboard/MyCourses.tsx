"use client";

import Link from "next/link";
import { useState } from "react";
import { removeMyCourse } from "@/app/learn/mycourses";

// The student's "My courses" shelf. Remove buttons are hidden by default and
// only appear in "Manage" mode, so the normal view stays clean. Adding courses
// is handled separately (the "＋ Add a course" expander below this).
export default function MyCourses({ courses }: { courses: { id: string; title: string }[] }) {
  const [managing, setManaging] = useState(false);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, margin: "32px 0 16px" }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem" }}>📚 My courses</h2>
        {courses.length > 0 && (
          <button
            type="button"
            className="btn small secondary"
            onClick={() => setManaging((m) => !m)}
          >
            {managing ? "✓ Done" : "⚙️ Manage"}
          </button>
        )}
      </div>

      {courses.length > 0 ? (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {courses.map((c) => (
            <div key={c.id} className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <Link href={`/learn/${c.id}`} style={{ display: "block" }}>
                <h3>📘 {c.title}</h3>
                <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
                  Open course → subjects, topics &amp; classes →
                </p>
              </Link>
              {managing && (
                <form action={removeMyCourse} style={{ marginTop: "auto", paddingTop: 12 }}>
                  <input type="hidden" name="course_id" value={c.id} />
                  <button className="btn small secondary" type="submit">✕ Remove from my courses</button>
                </form>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            📭 You haven&apos;t added any courses yet. Pick one below to add it to your courses.
          </p>
        </div>
      )}
    </>
  );
}
