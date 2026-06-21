"use client";

import { useState, type ReactNode } from "react";

// A collapsed-by-default section on the student topic page. The heavy content
// (video iframe, comments, etc.) is only mounted when the student opens it —
// so opening a topic shows a clean list, not every video at once.
export default function SectionCard({
  icon,
  title,
  typeLabel,
  meta,
  rightLabel,
  summaryChip,
  lockBadge,
  locked,
  children,
}: {
  icon: string;
  title: string;
  typeLabel: string;
  meta?: string;
  rightLabel?: string;
  summaryChip?: boolean;
  lockBadge?: ReactNode;
  locked?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`sec-card${locked ? " lock-card" : ""}`}>
      <div
        className="sec-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <span className="sec-ic">{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div className="sec-title">{title}</div>
          <div className="sec-type">{typeLabel}{meta ? ` · ${meta}` : ""}</div>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          {/* Class/revision number — same font + boldness as the title (.sec-title). */}
          {rightLabel && <span style={{ fontSize: "1.12rem", fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap" }}>{rightLabel}</span>}
          {summaryChip && (
            <span style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
              📋 Summary
            </span>
          )}
          {lockBadge}
          <span aria-hidden style={{ opacity: 0.6, fontSize: ".9rem", fontWeight: 700 }}>{open ? "▾" : "▸"}</span>
        </span>
      </div>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}
