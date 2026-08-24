"use client";

import { useMemo, useState } from "react";
import { formatINR } from "@/lib/pricing";
import SubmitButton from "@/app/components/SubmitButton";

// The same treatment the settlements queue got, for any queue that fills up:
// collapse to a handful, tick any subset, and keep the total of what is ticked
// in front of the person approving it. Amounts are SIGNED — money out negative,
// money in positive — so the bar can say both without inventing a convention.

export type QueueRow = {
  id: string; date: string; label: string; sub?: string | null;
  amount: number; badge?: string | null; status: string; error?: string | null;
  /** Prerendered journal-entry preview (server-built EntryLines). */
  detail?: React.ReactNode;
};

export default function QueuePicker({
  rows, approveSelected, skipSelected, firstShown = 12, approveLabel = "📤 Send selected for approval",
}: {
  rows: QueueRow[];
  approveSelected: (fd: FormData) => void | Promise<void>;
  skipSelected: (fd: FormData) => void | Promise<void>;
  firstShown?: number;
  approveLabel?: string;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const shown = showAll ? rows : rows.slice(0, firstShown);
  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const t = useMemo(() => {
    let out = 0, inn = 0;
    for (const r of rows) if (picked.has(r.id)) { if (r.amount < 0) out += -r.amount; else inn += r.amount; }
    return { out, inn, count: picked.size };
  }, [picked, rows]);

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <button type="button" className="btn small secondary"
          onClick={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((r) => r.id)))}>
          {allShownPicked ? "Clear selection" : `Select these ${shown.length}`}
        </button>
        {rows.length > firstShown && (
          <>
            <button type="button" className="btn small secondary" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `▲ Collapse to ${firstShown}` : `▼ Show all ${rows.length}`}
            </button>
            {!showAll && (
              <button type="button" className="btn small secondary" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>
                Select all {rows.length}
              </button>
            )}
          </>
        )}
        <span className="muted" style={{ fontSize: ".8rem" }}>showing {shown.length} of {rows.length}</span>
      </div>

      {t.count > 0 && (
        <div className="card" style={{ position: "sticky", top: 8, zIndex: 5, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", border: "2px solid var(--accent)" }}>
          <strong>{t.count} selected</strong>
          {t.out > 0 && <span>out <strong>{formatINR(t.out)}</strong></span>}
          {t.inn > 0 && <span>in <strong>{formatINR(t.inn)}</strong></span>}
          <span style={{ display: "inline-flex", gap: 8, marginLeft: "auto" }}>
            <form action={approveSelected} style={{ margin: 0 }}>
              {[...picked].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <SubmitButton className="btn small" savedLabel="📤 Sent for approval">{approveLabel}</SubmitButton>
            </form>
            <form action={skipSelected} style={{ margin: 0 }}>
              {[...picked].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <SubmitButton className="btn small secondary" savedLabel="✓">Skip selected</SubmitButton>
            </form>
            <button type="button" className="btn small secondary" onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
      )}

      <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
        {shown.map((r) => (
          <div key={r.id}>
          <label className="card"
            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", cursor: "pointer",
                     borderLeft: `4px solid ${r.status === "failed" ? "#b91c1c" : picked.has(r.id) ? "var(--accent)" : "transparent"}` }}>
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
            <span style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>{r.date}</span>
            <span style={{ flex: 1, minWidth: 200, fontSize: ".85rem" }}>
              {r.label}{r.sub ? <span className="muted"> · {r.sub}</span> : null}
            </span>
            <strong style={{ whiteSpace: "nowrap" }}>{r.amount < 0 ? `− ${formatINR(-r.amount)}` : formatINR(r.amount)}</strong>
            {r.badge && <span className="badge" style={{ fontSize: ".7rem" }}>{r.badge}</span>}
            {r.status === "failed" && <span style={{ fontSize: ".76rem", color: "#b91c1c" }}>{r.error}</span>}
          </label>
            {/* The entry this row becomes, prerendered by the server. It rides
                along as a ReactNode so this client component stays ignorant of
                accounting. */}
            {r.detail && (
              <details style={{ margin: "0 0 2px 34px" }}>
                <summary className="btn small secondary as-btn">📖 Journal entry</summary>
                <div style={{ marginTop: 6 }}>{r.detail}</div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
