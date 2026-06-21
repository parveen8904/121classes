"use client";

import Link from "next/link";
import { useState } from "react";
import { removeMyCourse } from "@/app/learn/mycourses";

// The student's "My courses" shelf. Remove buttons are hidden by default and
// only appear in "Manage" mode, so the normal view stays clean. Adding courses
// is handled separately (the "＋ Add a course" expander below this).
export default function MyCourses({ courses }: { courses: { id: string; title: string }[] }) {
  const [managingIds, setManagingIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setManagingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <h2 style={{ margin: "32px 0 16px", fontSize: "1.2rem" }}>📚 My courses</h2>

      {courses.length > 0 ? (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {courses.map((c) => {
            const managing = managingIds.has(c.id);
            return (
              <div key={c.id} className="card" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                {/* Clear, obviously-clickable course link */}
                <Link
                  href={`/learn/${c.id}`}
                  style={{ color: "var(--accent)", fontWeight: 800, fontSize: "1.2rem", textDecoration: "underline" }}
                >
                  📘 {c.title} →
                </Link>
                <p className="muted" style={{ fontSize: ".85rem", margin: 0 }}>
                  Tap the name above to open subjects, topics &amp; classes.
                </p>
                <div style={{ marginTop: "auto", paddingTop: 10 }}>
                  {managing ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <form action={removeMyCourse}>
                        <input type="hidden" name="course_id" value={c.id} />
                        <button className="btn small secondary" type="submit">✕ Remove from my courses</button>
                      </form>
                      <button type="button" className="btn small secondary" onClick={() => toggle(c.id)}>Done</button>
                    </div>
                  ) : (
                    <button type="button" className="btn small secondary" onClick={() => toggle(c.id)}>⚙️ Manage</button>
                  )}
                </div>
              </div>
            );
          })}
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
