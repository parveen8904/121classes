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
// "ALL" HAS TO MEAN ALL. The first version reached only the six work sections,
// which was 64% of the page: Documents to approve (the single largest block),
// the vault, Rule 115 and the build notes all stayed open, so pressing Collapse
// all barely shortened anything and the button looked broken. Everything with
// data-sec is now in scope — 91% of the page — and each summary carries its own
// count, so a fully collapsed desk still says where the work is.
//
// THE ONE EXCEPTION is the approvals gate. It is the reason the page exists, and
// a "collapse all" able to hide what is waiting on the founder would eventually
// hide it on a day it mattered.

const KEY = "zoho.sections";

export default function SectionToggle() {
  const [ready, setReady] = useState(false);

  // WHAT HE SET, PER SECTION — NOT JUST WHAT HE CLOSED.
  //
  // This first stored only the CLOSED list, which was fine while every section
  // started open. It is not any more: a section with nothing waiting now starts
  // closed on the server (open={count > 0}), so "not in the closed list" no
  // longer means "should be open". Opening an empty section was therefore
  // forgotten the moment the page reloaded.
  //
  // Storing the state of each section by id fixes that in both directions, and
  // keeps the property that mattered: an id ABSENT from the map keeps whatever
  // default the server gave it, so a section added later is never silently
  // hidden by a preference saved before it existed.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, boolean>;
      for (const el of Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-sec]"))) {
        if (el.id && Object.prototype.hasOwnProperty.call(saved, el.id)) el.open = saved[el.id];
      }
    } catch { /* a preference that cannot be read is not worth breaking a page for */ }
    setReady(true);
  }, []);

  function remember() {
    try {
      const state: Record<string, boolean> = {};
      for (const d of Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-sec]"))) {
        if (d.id) state[d.id] = d.open;
      }
      localStorage.setItem(KEY, JSON.stringify(state));
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
