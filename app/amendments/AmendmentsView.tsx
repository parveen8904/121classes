"use client";

import { useState } from "react";
import { attemptRank } from "@/app/learn/_lib/attempt";

export type AmendItem = {
  id: string;
  title: string;
  body: string | null;
  discussion: string | null;
  validFrom: string | null;
  validTo: string | null;
  notesHandUrl: string | null;
  videoSrc: string | null;
  tag: string | null; // subject / topic label
};

// CA exams are only in these months.
const MONTHS = ["January", "May", "September", "November"];

export default function AmendmentsView({ items, defaultAttempt }: { items: AmendItem[]; defaultAttempt: string }) {
  const init = (defaultAttempt || "").replace(/_/g, " ").trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => String(thisYear + i));
  const [month, setMonth] = useState(init ? (MONTHS.find((m) => m.toLowerCase() === init[1].toLowerCase()) ?? "") : "");
  const [year, setYear] = useState(init ? init[2] : "");

  const attempt = month && year ? `${month} ${year}` : "";
  const tr = attemptRank(attempt);

  const filtered = items.filter((it) => {
    if (tr === null) return true; // no attempt chosen → show everything
    const f = attemptRank(it.validFrom);
    const e = attemptRank(it.validTo);
    if (f !== null && tr < f) return false;
    if (e !== null && tr > e) return false;
    return true;
  });

  return (
    <div>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <strong style={{ fontSize: ".9rem" }}>🎯 Show amendments for attempt:</strong>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">Month…</option>
          {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)} style={{ minWidth: 100 }}>
          <option value="">Year…</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {attempt && <span className="muted" style={{ fontSize: ".82rem" }}>Showing what applies to <strong>{attempt}</strong></span>}
      </div>

      {filtered.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No amendments for this attempt yet. Change the attempt above to see others.</p></div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {filtered.map((it) => (
            <div className="card" key={it.id}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "1.05rem" }}>{it.title}</strong>
                {it.validFrom && <span className="badge">📅 Applicable from {it.validFrom}{it.validTo ? ` to ${it.validTo}` : " onwards"}</span>}
                {it.tag && <span className="muted" style={{ fontSize: ".8rem" }}>· {it.tag}</span>}
              </div>
              {it.body && <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{it.body}</p>}
              {it.videoSrc && (
                <div className="video-frame" style={{ marginTop: 10 }}>
                  <iframe src={it.videoSrc} allow="encrypted-media; fullscreen" allowFullScreen loading="lazy" title={it.title} />
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {it.notesHandUrl && <a className="btn small secondary" href={`/learn/pdf?u=${encodeURIComponent(it.notesHandUrl)}&t=Amendment notes`}>✍️ Handwritten notes (PDF)</a>}
              </div>
              {it.discussion && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", color: "var(--accent)" }}>🗣️ Discussion</summary>
                  <p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{it.discussion}</p>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
