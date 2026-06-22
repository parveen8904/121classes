"use client";

import { useState } from "react";

// One fillable remark box per date. Saves on blur via /api/plan-remark (no reload).
export default function RemarkBox({ date, initial }: { date: string; initial: string }) {
  const [val, setVal] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  async function save() {
    if (val === initial && state === "idle") return;
    setState("saving");
    try {
      await fetch("/api/plan-remark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, text: val }) });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  }

  return (
    <div>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        rows={2}
        placeholder="Your notes…"
        aria-label={`Remarks for ${date}`}
        style={{ width: "100%", fontSize: 12, padding: "4px 6px" }}
      />
      <span style={{ fontSize: 11, color: state === "saved" ? "#16a34a" : "var(--muted)" }}>
        {state === "saving" ? "saving…" : state === "saved" ? "✓ saved" : ""}
      </span>
    </div>
  );
}
