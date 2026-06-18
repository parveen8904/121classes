"use client";

import { useEffect, useState, useTransition } from "react";
import { polishSummary } from "../actions";

type CvType = "articleship" | "qualified" | "experienced";
type Data = Record<string, string>;

const TYPES: { key: CvType; label: string; desc: string }[] = [
  { key: "articleship", label: "Seeking articleship", desc: "CA student looking for articleship" },
  { key: "qualified", label: "Recently qualified CA", desc: "Cleared CA Final, fresher" },
  { key: "experienced", label: "Experienced CA", desc: "Working professional" },
];

// Fields shown per CV type (besides the common header + summary).
const FIELDS: Record<CvType, { key: string; label: string; rows?: number }[]> = {
  articleship: [
    { key: "education", label: "Education (Class 10/12 %, CA Foundation, CA Inter — group/marks)" },
    { key: "skills", label: "Skills (Tally, Excel, accounting, GST basics)", rows: 2 },
    { key: "strengths", label: "Strengths / why articleship", rows: 2 },
    { key: "achievements", label: "Achievements / extra-curricular", rows: 2 },
  ],
  qualified: [
    { key: "result", label: "CA Final — attempt cleared, rank/marks (if any)", rows: 2 },
    { key: "articleship", label: "Articleship experience (firm, period, areas of exposure)" },
    { key: "skills", label: "Skills (audit, tax, Ind AS, ERP, Excel…)", rows: 2 },
    { key: "achievements", label: "Achievements / certifications", rows: 2 },
  ],
  experienced: [
    { key: "experience", label: "Work experience (roles, companies, durations)", rows: 4 },
    { key: "domains", label: "Key domains (audit, direct/indirect tax, FR, advisory…)", rows: 2 },
    { key: "achievements", label: "Notable achievements", rows: 3 },
    { key: "skills", label: "Skills & tools", rows: 2 },
    { key: "certifications", label: "Certifications (DISA, IFRS, etc.)", rows: 2 },
  ],
};

const LABELS: Record<string, string> = {
  education: "Education", skills: "Skills", strengths: "Strengths", achievements: "Achievements",
  result: "CA Final result", articleship: "Articleship", experience: "Experience",
  domains: "Key domains", certifications: "Certifications",
};

const LS = "cv_builder_v2";

export default function CvBuilder({ defaults }: { defaults: { name: string; email: string; phone: string } }) {
  const [type, setType] = useState<CvType>("articleship");
  const [d, setD] = useState<Data>({ name: defaults.name, email: defaults.email, phone: defaults.phone });
  const [pending, start] = useTransition();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS);
      if (saved) { const p = JSON.parse(saved); if (p.type) setType(p.type); if (p.d) setD((x) => ({ ...x, ...p.d })); }
    } catch {}
  }, []);
  function set(k: string, v: string) {
    setD((c) => { const n = { ...c, [k]: v }; try { localStorage.setItem(LS, JSON.stringify({ type, d: n })); } catch {} return n; });
  }
  function chooseType(t: CvType) {
    setType(t); try { localStorage.setItem(LS, JSON.stringify({ type: t, d })); } catch {}
  }
  function polish() {
    start(async () => { const r = await polishSummary(d.summary || ""); if (r.ok && r.text) set("summary", r.text); });
  }

  const block = (title: string, body?: string) =>
    body?.trim() ? (
      <div style={{ marginTop: 14 }}>
        <h3 style={{ borderBottom: "2px solid var(--accent)", paddingBottom: 4, fontSize: "1rem" }}>{title}</h3>
        <p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{body}</p>
      </div>
    ) : null;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Type chooser */}
      <div className="form-card no-print">
        <h3>What is this CV for?</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {TYPES.map((t) => (
            <button key={t.key} type="button" onClick={() => chooseType(t.key)}
              className={`btn small ${type === t.key ? "" : "secondary"}`} title={t.desc}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 8 }}>{TYPES.find((t) => t.key === type)?.desc}</p>
      </div>

      {/* Editor */}
      <div className="form-card no-print">
        <h3>Your details</h3>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Full name</label><input value={d.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label>Location</label><input value={d.location || ""} onChange={(e) => set("location", e.target.value)} placeholder="City" /></div>
          <div><label>Email</label><input value={d.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
          <div><label>Phone</label><input value={d.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
        <label style={{ marginTop: 8 }}>Career objective / summary</label>
        <textarea rows={3} value={d.summary || ""} onChange={(e) => set("summary", e.target.value)} placeholder="A short objective…" />
        <button className="btn small secondary" type="button" onClick={polish} disabled={pending || !(d.summary || "").trim()}>
          {pending ? "Improving…" : "✨ Improve summary with AI"}
        </button>
        {FIELDS[type].map((f) => (
          <div key={f.key} style={{ marginTop: 10 }}>
            <label>{f.label}</label>
            <textarea rows={f.rows ?? 3} value={d[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
          </div>
        ))}
        <button className="btn" type="button" onClick={() => window.print()} style={{ marginTop: 8 }}>🖨️ Print / Save as PDF</button>
      </div>

      {/* Preview (prints) */}
      <div className="card" id="cv-preview">
        <h2 style={{ margin: 0 }}>{d.name || "Your Name"}</h2>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: ".9rem" }}>
          {[d.email, d.phone, d.location].filter(Boolean).join(" · ")}
        </p>
        {block("Summary", d.summary)}
        {FIELDS[type].map((f) => block(LABELS[f.key] || f.label.split(" (")[0], d[f.key]))}
      </div>
    </div>
  );
}
