"use client";

import { useEffect, useRef, useState } from "react";

type Row = {
  sectionId: string;
  title: string;
  subject: string;
  status: string; // none | pending | running | done | error
  pct: number;
  error?: string | null;
};

// Admin control for preparing classes for offline download. "Prepare" keeps
// calling the resumable API slice until the class is done — big classes just
// take a few rounds. The hourly cron also finishes anything left pending.
// A light poll keeps the progress bars live without refreshing (work happens
// server-side and per-64MB progress lands in offline_jobs as it goes).
export default function OfflineManager({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Live progress: poll the job table every 5s whenever anything is moving.
  useEffect(() => {
    const t = setInterval(async () => {
      const moving = rowsRef.current.some((r) => r.status === "running" || r.status === "pending");
      if (!moving) return;
      try {
        const res = await fetch("/api/admin/offline", { cache: "no-store" });
        if (!res.ok) return;
        const { jobs } = (await res.json()) as { jobs: { section_id: string; status: string; bytes_total: number | null; bytes_done: number; error: string | null }[] };
        const bySection = new Map(jobs.map((j) => [j.section_id, j]));
        setRows((rs) => rs.map((r) => {
          const j = bySection.get(r.sectionId);
          if (!j) return r;
          const total = Number(j.bytes_total) || 0;
          return { ...r, status: j.status, pct: total ? Math.floor(((Number(j.bytes_done) || 0) / total) * 100) : 0, error: j.error };
        }));
      } catch { /* transient — next tick retries */ }
    }, 5000);
    return () => clearInterval(t);
  }, []);

  async function prepare(sectionId: string): Promise<"done" | "waiting" | "error"> {
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
        if (j.done) return "done";
        if (j.status === "error") return "error";
        if (j.status === "pending") return "waiting"; // Bunny re-encoding — the hourly run resumes it
      }
      return "waiting";
    } finally {
      setBusyId(null);
    }
  }

  async function prepareAll() {
    setBulk(true);
    try {
      for (const r of rowsRef.current) {
        if (r.status === "done") continue;
        const res = await prepare(r.sectionId);
        if (res === "error") break; // stop on a real error so it's visible; waiting classes continue on their own
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
        {rows.map((r) => {
          const active = r.status === "running" || busyId === r.sectionId;
          return (
            <div key={r.sectionId} style={{ background: "var(--bg-soft)", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <strong style={{ fontSize: ".9rem" }}>{r.title}</strong>
                  <span className="muted" style={{ fontSize: ".78rem" }}> · {r.subject}</span>
                  {r.error && r.status === "error" && <div style={{ color: "#dc2626", fontSize: ".78rem" }}>⚠️ {r.error}</div>}
                </div>
                {r.status === "done" ? (
                  <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>✅ Ready</span>
                ) : r.status === "pending" && busyId !== r.sectionId ? (
                  <span className="muted" style={{ fontSize: ".8rem" }}>🐰 Bunny re-encoding — continues automatically</span>
                ) : active ? (
                  <span style={{ fontWeight: 700, fontSize: ".85rem" }}>⏳ {r.pct}%</span>
                ) : (
                  <button className="btn small secondary" type="button" disabled={bulk || !!busyId} onClick={() => prepare(r.sectionId)}>
                    Prepare
                  </button>
                )}
              </div>
              {active && (
                <div style={{ marginTop: 6, height: 6, borderRadius: 3, background: "var(--bg)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(r.pct, 2)}%`, borderRadius: 3, background: "#0d9488", transition: "width .8s ease" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
