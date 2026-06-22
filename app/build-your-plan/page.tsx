import { Fragment } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Build your study plan — CA Parveen Sharma",
  description: "A personal, day-by-day study plan to exam day — disciplined, targeted and mentored. Daily targets, revision rounds, most-important-questions, doubt-solving on WhatsApp/Telegram, and progress tracking.",
};

const STAGES = [
  { n: "1", t: "Exhaustive", d: "Detailed classes, topic by topic in order of importance — with homework and weekly deep tests." },
  { n: "2", t: "Revision 1", d: "Revision videos + RTP/MTP, past papers and your most-important-questions." },
  { n: "3", t: "Revision 2", d: "Faster revision videos + a mock test + the questions you marked to repeat." },
  { n: "4", t: "Final round", d: "Last-mile checklist: marked questions, quick passes, a final mock — right up to exam day." },
];

const SAMPLE = [
  { stage: "Stage 1 · Exhaustive", date: "Mon, 1 Aug", task: "Class 12 · AS 13 Accounting for Investments", meta: "1h 20m · watch at 1.5× · do homework if any" },
  { stage: "", date: "Sun, 7 Aug", task: "Deep test — AS 13", meta: "MCQ + descriptive test in app", test: true },
  { stage: "Stage 2 · Revision round 1", date: "Tue, 3 Mar", task: "AS 13 — revision video + RTP/MTP · do Q2, Q3, Q4", meta: "watch revision video at 1.5×" },
  { stage: "Stage 4 · Final revision", date: "Wed, 29 Apr", task: "Marked MIQs → quick pass → revision @2× → final mock → re-check RTP", meta: "final push · 11h/day" },
];

function Pillars() {
  const items = [
    { i: "🎯", t: "Disciplined", d: "A clear target every single day, weekly deep tests on Sundays, and an on-track meter that warns you the moment you fall behind — with one tap to re-balance the rest of your plan." },
    { i: "🧭", t: "Targeted", d: "Study only what matters: pick all topics, the important ones (A / A+B), or hand-pick your own. Each day lists the exact most-important-questions to solve, ordered by exam weightage." },
    { i: "🤝", t: "Mentored", d: "Your daily target arrives on Telegram and your dashboard. Ask doubts anytime on WhatsApp, Telegram or email — answered instantly by AI and escalated to CA Parveen Sharma when needed." },
  ];
  return (
    <div className="grid grid-3">
      {items.map((x) => (
        <div className="tile" key={x.t} style={{ textAlign: "left" }}>
          <div className="ic">{x.i}</div>
          <h3 style={{ fontSize: "1.1rem" }}>{x.t}</h3>
          <p className="muted" style={{ fontSize: ".9rem" }}>{x.d}</p>
        </div>
      ))}
    </div>
  );
}

export default function BuildYourPlanPage() {
  return (
    <>
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">🗓️ Build your plan</span>
          <h2>Your own day-by-day plan to exam day</h2>
          <p>
            Tell us your subject, start date and exam date — and get a personal, day-by-day study plan that knows exactly
            what you should do today, keeps you on track, and adjusts the moment life happens. Disciplined, targeted, and
            mentored by <strong>CA Parveen Sharma &amp; team</strong>.
          </p>
        </div>
        <div style={{ textAlign: "center" }}>
          <Link className="btn" href="/planner">Build my plan →</Link>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">🧱 How it works</span>
          <h2>Four stages, planned backwards from your exam</h2>
          <p>The engine works backward from your exam date, orders topics by importance, and fits the classes into your time — speeding up the videos only as much as needed, and warning you (with fixes) if it&apos;s tight.</p>
        </div>
        <div className="grid grid-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {STAGES.map((s) => (
            <div className="tile" key={s.n} style={{ textAlign: "left" }}>
              <div className="ic">{s.n}</div>
              <h3 style={{ fontSize: "1.05rem" }}>{s.t}</h3>
              <p className="muted" style={{ fontSize: ".88rem" }}>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">📄 Sample plan</span>
          <h2>This is what your plan looks like</h2>
          <p>Every day is one clear target — the class to watch (and at what speed), the questions to do, the test to take. You add your own remarks, and download the whole plan as a PDF.</p>
        </div>
        <div className="card" style={{ maxWidth: 720, margin: "0 auto", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "8px 6px" }}>Date</th>
                <th style={{ padding: "8px 6px" }}>Today&apos;s target</th>
              </tr>
            </thead>
            <tbody style={{ verticalAlign: "top" }}>
              {SAMPLE.map((r, i) => (
                <Fragment key={i}>
                  {r.stage && <tr><td colSpan={2} style={{ padding: "10px 6px 4px", fontWeight: 600, color: "var(--accent)" }}>{r.stage}</td></tr>}
                  <tr style={{ borderBottom: "1px solid var(--border)", background: r.test ? "var(--bg-soft,#f8fafc)" : undefined }}>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r.date}</td>
                    <td style={{ padding: "8px 6px" }}><strong>{r.task}</strong><br /><span style={{ fontStyle: "italic", fontSize: 12, color: "var(--muted)" }}>{r.meta}</span></td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ textAlign: "center", fontSize: ".82rem", marginTop: 10 }}>Illustrative — your real plan is built from your subject, dates and pace.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">✨ Why it works</span>
          <h2>Disciplined. Targeted. Mentored.</h2>
        </div>
        <Pillars />
      </section>

      <section className="section" style={{ textAlign: "center" }}>
        <h2>Stop guessing what to study today</h2>
        <p className="muted" style={{ maxWidth: 560, margin: "8px auto 16px" }}>
          Build your plan in under a minute — pick your subject, your exam date and your pace. We&apos;ll handle the rest, every single day.
        </p>
        <Link className="btn" href="/planner">Build my plan →</Link>
      </section>
    </>
  );
}
