"use client";

import { useMemo, useState } from "react";
import { formatINR } from "@/lib/pricing";
import SubmitButton from "@/app/components/SubmitButton";

// A HUNDRED ROWS IS NOT A LIST, IT IS A WALL.
//
// The settlements queue opened with 107 rows and an all-or-nothing "approve
// all" — so working a few days at a time, or ticking only what has been checked
// against the Razorpay dashboard, meant scrolling past everything else. This
// collapses to a handful, lets any subset be picked, and keeps the total of
// what is picked in front of the person deciding — because the figure they are
// approving is the whole point.

export type PickRow = {
  id: string; settled_on: string; net: number; fees: number; gross: number;
  utr: string | null; settlement_id: string; status: string; error: string | null;
};

const FIRST_SHOWN = 12;

export default function SettlementPicker({
  rows, approveSelected, skipSelected,
}: {
  rows: PickRow[];
  approveSelected: (fd: FormData) => void | Promise<void>;
  skipSelected: (fd: FormData) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const shown = showAll ? rows : rows.slice(0, FIRST_SHOWN);
  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totals = useMemo(() => {
    let net = 0, gross = 0, fees = 0;
    for (const r of rows) if (picked.has(r.id)) { net += r.net; gross += r.gross; fees += r.fees; }
    return { net, gross, fees, count: picked.size };
  }, [picked, rows]);

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <button type="button" className="btn small secondary"
          onClick={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((r) => r.id)))}>
          {allShownPicked ? "Clear selection" : `Select these ${shown.length}`}
        </button>
        {rows.length > FIRST_SHOWN && (
          <button type="button" className="btn small secondary" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `▲ Collapse to ${FIRST_SHOWN}` : `▼ Show all ${rows.length}`}
          </button>
        )}
        {rows.length > FIRST_SHOWN && !showAll && (
          <button type="button" className="btn small secondary" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>
            Select all {rows.length}
          </button>
        )}
        <span className="muted" style={{ fontSize: ".8rem" }}>
          showing {shown.length} of {rows.length}
        </span>
      </div>

      {/* The running total of what is ticked — the number being approved. */}
      {totals.count > 0 && (
        <div className="card" style={{ position: "sticky", top: 8, zIndex: 5, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", border: "2px solid var(--accent)" }}>
          <strong>{totals.count} selected</strong>
          <span>net <strong>{formatINR(totals.net)}</strong></span>
          <span className="muted">gross {formatINR(totals.gross)}</span>
          <span className="muted">fee+GST {formatINR(totals.fees)}</span>
          <span style={{ display: "inline-flex", gap: 8, marginLeft: "auto" }}>
            <form action={approveSelected} style={{ margin: 0 }}>
              {[...picked].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <SubmitButton className="btn small" savedLabel="✓ Posted">✅ Approve &amp; post selected</SubmitButton>
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
          <label key={r.id} className="card"
            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", cursor: "pointer",
                     borderLeft: `4px solid ${r.status === "failed" ? "#b91c1c" : picked.has(r.id) ? "var(--accent)" : "transparent"}` }}>
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
            <strong style={{ minWidth: 92 }}>{r.settled_on}</strong>
            <span style={{ flex: 1, minWidth: 220, fontSize: ".85rem" }}>
              net <strong>{formatINR(r.net)}</strong>
              <span className="muted"> · fee+GST {formatINR(r.fees)} · gross {formatINR(r.gross)} · UTR {r.utr || "—"}</span>
            </span>
            {r.status === "failed" && <span style={{ fontSize: ".76rem", color: "#b91c1c" }}>{r.error}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
