"use client";

import { useState } from "react";

export type Opening = {
  id: string;
  title: string;
  meta: string; // "company · location · source · 2d ago"
  category: string;
  url: string;
};

// Paginated openings list — shows a page at a time so the Career page stays
// short. "Show more" reveals the next batch without a reload.
const PAGE = 12;

export default function CareerOpenings({ openings, city }: { openings: Opening[]; city?: string }) {
  const [shown, setShown] = useState(PAGE);
  const visible = openings.slice(0, shown);

  if (!openings.length) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: "1.15rem" }}>
        💼 Latest openings{city ? ` in ${city}` : ""}{" "}
        <span className="muted" style={{ fontSize: ".85rem", fontWeight: 400 }}>({openings.length})</span>
      </h2>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {visible.map((j) => (
          <div className="card" key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <strong>{j.title}</strong>
              <p className="muted" style={{ fontSize: ".82rem", margin: "2px 0 0" }}>
                {j.category ? `${j.category} · ` : ""}{j.meta}
              </p>
            </div>
            <a className="btn small" href={j.url} target="_blank" rel="noopener noreferrer">Apply →</a>
          </div>
        ))}
      </div>
      {shown < openings.length && (
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button className="btn secondary" type="button" onClick={() => setShown((n) => n + PAGE)}>
            Show more openings ({openings.length - shown} more)
          </button>
        </div>
      )}
    </div>
  );
}
