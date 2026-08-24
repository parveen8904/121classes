"use client";

import { useEffect, useState } from "react";

// COLLAPSE THE WHOLE DESK, OR OPEN IT.
//
// The page carries every part of the books — sales, settlements, statements,
// petty cash, investments, tax — and on most days he is there for one of them.
// Reordering it so his approvals come first helped; it did not make the rest of
// it shorter. This does.
//
// WHY THE SECTIONS ARE PLAIN <details> AND THIS ONLY DRIVES THEM. Each section
// is server-rendered and works with JavaScript off — a summary you can click is
// browser behaviour, not something React has to be present for. This component
// adds the two buttons that act on all of them at once, and nothing else
// depends on it having loaded.
//
// WHAT IS DELIBERATELY NOT COLLAPSIBLE: the approvals gate and the documents
// waiting on him. Those are the reason the page exists, and a "collapse all"
// that could hide the work waiting on the founder would eventually hide it on a
// day it mattered.

const KEY = "zoho.sections.closed";

export default function SectionToggle() {
  const [ready, setReady] = useState(false);

  // Put back whatever he left closed. Stored as the CLOSED list rather than the
  // open one, so a section added later is open by default instead of silently
  // hidden by a preference saved before it existed.
  useEffect(() => {
    try {
      const closed: string[] = JSON.parse(localStorage.getItem(KEY) || "[]");
      for (const el of Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-sec]"))) {
        if (el.id && closed.includes(el.id)) el.open = false;
      }
    } catch { /* a preference that cannot be read is not worth breaking a page for */ }
    setReady(true);
  }, []);

  function remember() {
    try {
      const closed = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-sec]"))
        .filter((d) => !d.open && d.id).map((d) => d.id);
      localStorage.setItem(KEY, JSON.stringify(closed));
    } catch { /* ignore */ }
  }

  // Each section remembers itself as he opens and closes it, not only when
  // these buttons are used.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-sec]"));
    els.forEach((el) => el.addEventListener("toggle", remember));
    return () => els.forEach((el) => el.removeEventListener("toggle", remember));
  }, []);

  function setAll(open: boolean) {
    for (const el of Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-sec]"))) {
      el.open = open;
    }
    remember();
  }

  // Rendered only once the stored preference has been applied, so the buttons
  // cannot be pressed against a state that is about to be overwritten.
  if (!ready) return null;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button type="button" className="btn small secondary" onClick={() => setAll(false)}>⊟ Collapse all</button>
      <button type="button" className="btn small secondary" onClick={() => setAll(true)}>⊞ Expand all</button>
    </div>
  );
}
