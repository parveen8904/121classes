"use client";

import { useState, useTransition } from "react";
import { applyPlanTemplate } from "./actions";

// Attractive one-tap plan templates. Each card tracks its OWN busy state (the
// old version put six submit buttons in one form, so tapping one showed ALL of
// them "Saving…" — confusing). Templates are pre-computed server-side.
const HORIZONS = [
  { days: 15, icon: "⚡", note: "Crash sprint" },
  { days: 30, icon: "🔥", note: "Fast track" },
  { days: 60, icon: "🚀", note: "Focused push" },
  { days: 90, icon: "🎯", note: "Steady & solid" },
  { days: 150, icon: "🏗️", note: "Strong foundation" },
  { days: 180, icon: "🏆", note: "The full journey" },
];

export default function TemplatePicker({ subjects }: { subjects: { id: string; title: string }[] }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [busyDays, setBusyDays] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  if (subjects.length === 0) return null;

  function pick(days: number) {
    if (busyDays !== null) return;
    setBusyDays(days);
    startTransition(async () => {
      try {
        await applyPlanTemplate(subjectId, days);
      } finally {
        setBusyDays(null);
      }
    });
  }

  return (
    <div
      style={{
        background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--card)), var(--card))",
        border: "2px solid var(--accent)",
        borderRadius: 16,
        padding: "18px 18px 16px",
      }}
    >
      <strong style={{ fontSize: "1.05rem" }}>⚡ Ready-made plans — one tap and it&apos;s done</strong>
      <p className="muted" style={{ fontSize: ".84rem", margin: "4px 0 12px" }}>
        Pick how far your exam is — the complete day-by-day plan appears instantly. You can modify it or
        generate it again anytime with your own details.
      </p>
      <label style={{ fontSize: ".8rem" }}>Subject</label>
      <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ marginBottom: 12 }}>
        {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {HORIZONS.map((h) => {
          const busy = busyDays === h.days;
          return (
            <button
              key={h.days}
              type="button"
              disabled={busyDays !== null}
              onClick={() => pick(h.days)}
              style={{
                cursor: busyDays === null ? "pointer" : "default",
                textAlign: "center",
                border: "1px solid var(--border)",
                background: busy ? "linear-gradient(90deg, var(--accent), var(--accent-2))" : "var(--card)",
                color: busy ? "#fff" : "var(--text)",
                borderRadius: 14,
                padding: "14px 10px",
                boxShadow: "0 2px 10px rgba(0,0,0,.06)",
                opacity: busyDays !== null && !busy ? 0.55 : 1,
              }}
            >
              <div style={{ fontSize: "1.5rem", lineHeight: 1 }}>{h.icon}</div>
              <div style={{ fontWeight: 800, fontSize: "1.05rem", marginTop: 6 }}>{h.days} days</div>
              <div style={{ fontSize: ".74rem", opacity: 0.85 }}>before exam</div>
              <div style={{ fontSize: ".78rem", fontWeight: 700, marginTop: 4, color: busy ? "#fff" : "var(--accent)" }}>
                {busy ? "⏳ Building your plan…" : h.note}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
