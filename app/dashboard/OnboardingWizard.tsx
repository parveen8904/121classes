"use client";

import { useState } from "react";
import AttemptPicker from "@/app/components/AttemptPicker";
import { completeOnboarding } from "./onboarding-actions";

type Course = { id: string; title: string };
type Subject = { id: string; title: string };

// Friendly first-visit wizard: ASK the student what they study and write the
// profile from the answers — never send them away to a profile form first.
export default function OnboardingWizard({
  courses,
  subjectsByCourse,
  needAttempt,
}: {
  courses: Course[];
  subjectsByCourse: Record<string, Subject[]>;
  needAttempt: boolean;
}) {
  const [courseId, setCourseId] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const subjects = courseId ? subjectsByCourse[courseId] ?? [] : [];

  const pickCourse = (id: string) => {
    setCourseId(id);
    setChosen(new Set((subjectsByCourse[id] ?? []).map((s) => s.id))); // all pre-ticked — most students take the full level
  };
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="card" style={{ marginTop: 18, border: "1px solid var(--accent)" }}>
      <h2 style={{ marginTop: 0, fontSize: "1.15rem" }}>👋 Welcome! Let&apos;s set you up in 30 seconds</h2>

      <form action={completeOnboarding}>
        <p style={{ fontWeight: 700, marginBottom: 8 }}>1️⃣ Which level are you studying?</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {courses.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`btn small ${courseId === c.id ? "" : "secondary"}`}
              onClick={() => pickCourse(c.id)}
            >
              📘 {c.title}
            </button>
          ))}
        </div>
        <input type="hidden" name="course_id" value={courseId} />

        {courseId && subjects.length > 0 && (
          <>
            <p style={{ fontWeight: 700, margin: "18px 0 8px" }}>2️⃣ Which subjects do you want? <span className="muted" style={{ fontWeight: 400, fontSize: ".82rem" }}>(all selected — untick any you don&apos;t need)</span></p>
            <div style={{ display: "grid", gap: 6 }}>
              {subjects.map((s) => (
                <label key={s.id} className="remember" style={{ margin: 0 }}>
                  <input type="checkbox" name="subj" value={s.id} checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />{" "}
                  {s.title}
                </label>
              ))}
            </div>
          </>
        )}

        {courseId && needAttempt && (
          <>
            <p style={{ fontWeight: 700, margin: "18px 0 8px" }}>3️⃣ Which exam attempt are you preparing for?</p>
            <AttemptPicker name="target_attempt" required />
          </>
        )}

        {courseId && (
          <button className="btn" type="submit" style={{ marginTop: 18 }}>
            ✅ Done — set up my dashboard
          </button>
        )}
      </form>
    </div>
  );
}
