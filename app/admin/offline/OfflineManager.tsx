"use client";

import { useState } from "react";

type Row = {
  sectionId: string;
  title: string;
  subject: string;
  status: string; // none | pending | running | done | error
  pct: number;
  error?: string | null;
};

const fmtGb = (b?: number | null) => (b ? `${(b / 1e9).toFixed(2)} GB` : "");

// Admin control for preparing classes for offline download. "Prepare" keeps
// calling the resumable API slice until the class is done — big classes just
// take a few rounds. The hourly cron also finishes anything left pending.
export default function OfflineManager({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);

  async function prepare(sectionId: string): Promise<boolean> {
    setBusyId(sectionId);
    try {
      // Keep slicing until done/error (each call ≤ ~4 min server-side).
      for (let i = 0; i < 40; i++) {
        const res = await fetch("/api/admin/offline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sectionId }),
        });
        const j = (await res.json()) as { done: boolean; status: string; bytesDone: number; bytesTotal: number | null; error?: string };
        setRows((rs) => rs.map((r) => r.sectionId === sectionId
          ? { ...r, status: j.status, pct: j.bytesTotal ? Math.floor((j.bytesDone / j.bytesTotal) * 100) : 0, error: j.error ?? null }
          : r));
        if (j.done) return true;
        if (j.status === "error") return false;
      }
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function prepareAll() {
    setBulk(true);
    try {
      for (const r of rows) {
        if (r.status === "done") continue;
        const ok = await prepare(r.sectionId);
        if (!ok) break; // stop on first error so it's visible
      }
    } finally {
      setBulk(false);
    }
  }

  const doneCount = rows.filter((r) => r.status === "done").length;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "14px 0" }}>
        <button className="btn" type="button" disabled={bulk || !!busyId} onClick={prepareAll}>
          {bulk ? "Preparing… (leave this tab open)" : "▶️ Prepare ALL remaining classes"}
        </button>
        <span className="muted" style={{ fontSize: ".85rem" }}>
          ✅ {doneCount}/{rows.length} ready · You can also close this page — the hourly automatic run continues any class already started or queued.
        </span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.sectionId} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-soft)", borderRadius: 10, padding: "8px 12px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong style={{ fontSize: ".9rem" }}>{r.title}</strong>
              <span className="muted" style={{ fontSize: ".78rem" }}> · {r.subject}</span>
              {r.error && <div style={{ color: "#dc2626", fontSize: ".78rem" }}>⚠️ {r.error}</div>}
            </div>
            {r.status === "done" ? (
              <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>✅ Ready</span>
            ) : r.status === "running" || busyId === r.sectionId ? (
              <span style={{ fontWeight: 700, fontSize: ".85rem" }}>⏳ {r.pct}%</span>
            ) : (
              <button className="btn small secondary" type="button" disabled={bulk || !!busyId} onClick={() => prepare(r.sectionId)}>
                Prepare
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
