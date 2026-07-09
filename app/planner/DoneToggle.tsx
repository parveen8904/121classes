"use client";

import { useState, useTransition } from "react";
import { setClassDone } from "./actions";

// A plan line with an INSTANT done toggle: tap → strike-through + green badge
// immediately (the server is updated in the background); tap again to undo.
export default function DoneToggle({
  sectionId,
  initialDone,
  task,
  meta,
}: {
  sectionId: string;
  initialDone: boolean;
  task: string;
  meta: string;
}) {
  const [done, setDone] = useState(initialDone);
  const [, start] = useTransition();

  const toggle = () => {
    const next = !done;
    setDone(next); // instant feedback — no waiting for the server
    start(async () => {
      try {
        await setClassDone(sectionId, next);
      } catch {
        setDone(!next); // server unreachable — revert so the truth stays honest
      }
    });
  };

  return (
    <>
      <strong style={done ? { textDecoration: "line-through", opacity: 0.65 } : undefined}>{task}</strong>
      <br />
      <span style={{ fontStyle: "italic", fontSize: 12, color: "var(--muted)" }}>{meta}</span>
      {done ? (
        <button
          type="button"
          onClick={toggle}
          className="no-print"
          style={{ background: "#16a34a", color: "#fff", border: 0, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, marginLeft: 6, cursor: "pointer", whiteSpace: "nowrap" }}
          title="Tap to mark undone"
        >
          ✅ Done · undo
        </button>
      ) : (
        <button type="button" onClick={toggle} className="btn small secondary no-print" style={{ marginLeft: 6, padding: "0 6px", fontSize: 11 }}>
          mark done
        </button>
      )}
    </>
  );
}
