"use client";

import { useEffect, useState, useTransition } from "react";
import { polishSummary } from "../actions";

type Cv = {
  name: string; email: string; phone: string; location: string;
  summary: string; education: string; experience: string; skills: string; achievements: string;
};
const LS = "cv_builder";

export default function CvBuilder({ defaults }: { defaults: { name: string; email: string; phone: string } }) {
  const [cv, setCv] = useState<Cv>({
    name: defaults.name, email: defaults.email, phone: defaults.phone, location: "",
    summary: "", education: "", experience: "", skills: "", achievements: "",
  });
  const [pending, start] = useTransition();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS);
      if (saved) setCv((c) => ({ ...c, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  function set<K extends keyof Cv>(k: K, v: string) {
    setCv((c) => { const n = { ...c, [k]: v }; try { localStorage.setItem(LS, JSON.stringify(n)); } catch {} return n; });
  }
  function polish() {
    start(async () => {
      const r = await polishSummary(cv.summary);
      if (r.ok && r.text) set("summary", r.text);
    });
  }

  const Field = ({ k, label, rows = 3 }: { k: keyof Cv; label: string; rows?: number }) => (
    <div style={{ marginBottom: 10 }}>
      <label>{label}</label>
      <textarea rows={rows} value={cv[k]} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  const block = (title: string, body: string) =>
    body.trim() ? (
      <div style={{ marginTop: 14 }}>
        <h3 style={{ borderBottom: "2px solid var(--accent)", paddingBottom: 4, fontSize: "1rem" }}>{title}</h3>
        <p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{body}</p>
      </div>
    ) : null;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Editor */}
      <div className="form-card no-print">
        <h3>Your details</h3>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Full name</label><input value={cv.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label>Location</label><input value={cv.location} onChange={(e) => set("location", e.target.value)} placeholder="City" /></div>
          <div><label>Email</label><input value={cv.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><label>Phone</label><input value={cv.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
        <label style={{ marginTop: 8 }}>Career objective / summary</label>
        <textarea rows={3} value={cv.summary} onChange={(e) => set("summary", e.target.value)} placeholder="A short objective…" />
        <button className="btn small secondary" type="button" onClick={polish} disabled={pending || !cv.summary.trim()}>
          {pending ? "Improving…" : "✨ Improve summary with AI"}
        </button>
        <Field k="education" label="Education (CA Foundation/Inter/Final, marks, school/college)" />
        <Field k="experience" label="Articleship / experience" />
        <Field k="skills" label="Skills (Tally, Excel, GST, audit…)" rows={2} />
        <Field k="achievements" label="Achievements / certifications" rows={2} />
        <button className="btn" type="button" onClick={() => window.print()} style={{ marginTop: 6 }}>🖨️ Print / Save as PDF</button>
      </div>

      {/* Preview (this is what prints) */}
      <div className="card" id="cv-preview">
        <h2 style={{ margin: 0 }}>{cv.name || "Your Name"}</h2>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: ".9rem" }}>
          {[cv.email, cv.phone, cv.location].filter(Boolean).join(" · ")}
        </p>
        {block("Summary", cv.summary)}
        {block("Education", cv.education)}
        {block("Articleship / Experience", cv.experience)}
        {block("Skills", cv.skills)}
        {block("Achievements", cv.achievements)}
      </div>
    </div>
  );
}
