"use client";

import { useState } from "react";
import AttemptPicker from "@/app/components/AttemptPicker";
import { completeOnboarding, completeSponsorSetup } from "./onboarding-actions";

type Course = { id: string; title: string };
type Subject = { id: string; title: string };

// Mandatory first-visit setup. Everyone must give a phone number. A STUDENT then
// picks level → subjects → attempt (subjects are pre-ticked; at least one is
// required). A SPONSOR just gives their phone, then goes to gift a subscription.
export default function OnboardingWizard({
  courses, subjectsByCourse, needAttempt, defaultPhone,
}: {
  courses: Course[];
  subjectsByCourse: Record<string, Subject[]>;
  needAttempt: boolean;
  defaultPhone?: string | null;
}) {
  const [mode, setMode] = useState<"" | "student" | "sponsor">("");
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [courseId, setCourseId] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const subjects = courseId ? subjectsByCourse[courseId] ?? [] : [];

  const pickCourse = (id: string) => {
    setCourseId(id);
    setChosen(new Set((subjectsByCourse[id] ?? []).map((s) => s.id))); // all pre-ticked
  };
  const toggle = (id: string) =>
    setChosen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const phoneOk = phone.replace(/\D/g, "").length >= 10;

  return (
    <div className="card" style={{ marginTop: 18, border: "1px solid var(--accent)" }}>
      <h2 style={{ marginTop: 0, fontSize: "1.15rem" }}>👋 Welcome! A quick setup to continue</h2>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: -4 }}>This is required once — it can&apos;t be skipped, so you never have to fill it later.</p>

      <p style={{ fontWeight: 700, margin: "14px 0 8px" }}>Are you here to study, or to sponsor/gift for someone?</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={`btn small ${mode === "student" ? "" : "secondary"}`} onClick={() => setMode("student")}>🎓 I&apos;m here to study</button>
        <button type="button" className={`btn small ${mode === "sponsor" ? "" : "secondary"}`} onClick={() => setMode("sponsor")}>🎁 I&apos;m sponsoring / gifting for someone</button>
      </div>

      {mode && (
        <div style={{ marginTop: 16 }}>
          <label>📱 Your mobile number *</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="10-digit mobile" required />
        </div>
      )}

      {/* STUDENT path */}
      {mode === "student" && (
        <form action={completeOnboarding} style={{ marginTop: 8 }}>
          <input type="hidden" name="phone" value={phone} />
          <p style={{ fontWeight: 700, margin: "18px 0 8px" }}>1️⃣ Which level are you studying? *</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {courses.map((c) => (
              <button key={c.id} type="button" className={`btn small ${courseId === c.id ? "" : "secondary"}`} onClick={() => pickCourse(c.id)}>📘 {c.title}</button>
            ))}
          </div>
          <input type="hidden" name="course_id" value={courseId} />

          {courseId && subjects.length > 0 && (
            <>
              <p style={{ fontWeight: 700, margin: "18px 0 8px" }}>2️⃣ Which subjects? * <span className="muted" style={{ fontWeight: 400, fontSize: ".82rem" }}>(all selected — untick any you don&apos;t need; keep at least one)</span></p>
              <div style={{ display: "grid", gap: 6 }}>
                {subjects.map((s) => (
                  <label key={s.id} className="remember" style={{ margin: 0 }}>
                    <input type="checkbox" name="subj" value={s.id} checked={chosen.has(s.id)} onChange={() => toggle(s.id)} /> {s.title}
                  </label>
                ))}
              </div>
            </>
          )}

          {courseId && needAttempt && (
            <>
              <p style={{ fontWeight: 700, margin: "18px 0 8px" }}>3️⃣ Which exam attempt are you preparing for? *</p>
              <AttemptPicker name="target_attempt" required />
            </>
          )}

          {courseId && (
            <>
              <p style={{ fontWeight: 700, margin: "18px 0 8px" }}>💬 How did you hear about us? <span className="muted" style={{ fontWeight: 400, fontSize: ".82rem" }}>(optional)</span></p>
              <select name="heard_from" defaultValue="">
                <option value="">Select one (optional)</option>
                <option value="youtube">YouTube</option><option value="telegram">Telegram</option>
                <option value="friend">A friend / classmate</option><option value="google">Google search</option>
                <option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option>
                <option value="attended_before">Attended CA Parveen Sharma&apos;s classes before</option><option value="other">Other</option>
              </select>
            </>
          )}

          <button className="btn" type="submit" style={{ marginTop: 18 }} disabled={!phoneOk || !courseId || chosen.size === 0 || (needAttempt && false)}>
            ✅ Done — set up my dashboard
          </button>
          {(!phoneOk || !courseId || chosen.size === 0) && <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>Please add your mobile number, pick your level, and keep at least one subject.</p>}
        </form>
      )}

      {/* SPONSOR path */}
      {mode === "sponsor" && (
        <form action={completeSponsorSetup} style={{ marginTop: 8 }}>
          <input type="hidden" name="phone" value={phone} />
          <p className="muted" style={{ fontSize: ".88rem", marginTop: 14 }}>
            Great! You&apos;ll pay for a subscription and we&apos;ll set it up for the person you choose. Continue to fill their details and pay.
          </p>
          <button className="btn" type="submit" style={{ marginTop: 8 }} disabled={!phoneOk}>🎁 Continue to Sponsor a Student →</button>
          {!phoneOk && <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>Please add your mobile number to continue.</p>}
        </form>
      )}
    </div>
  );
}
