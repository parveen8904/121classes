"use client";

import { useEffect, useRef, useState } from "react";

// Tick every answer key at once.
//
// The row checkboxes are not children of the toolbar form — they attach to it
// by id — so this walks the document for them rather than the form's subtree.
//
// The checkbox is NOT nested inside its <label>: a click landing on an input
// inside its own label can be counted twice (once directly, once forwarded by
// the label), which toggled every row on and straight back off again. `htmlFor`
// keeps the label clickable without that ambiguity.
export default function SelectAllKeys({ formId, name }: { formId: string; name: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);

  function boxes(): HTMLInputElement[] {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"][form="${formId}"]`),
    );
  }

  function sync() {
    const all = boxes();
    const on = all.filter((b) => b.checked).length;
    setCount(on);
    if (ref.current) {
      ref.current.checked = on > 0 && on === all.length;
      ref.current.indeterminate = on > 0 && on < all.length;
    }
  }

  // Keep the header box honest when rows are ticked one by one: all ticked
  // shows ticked, some ticked shows the dash.
  useEffect(() => {
    sync();
    const onChange = (e: Event) => {
      if ((e.target as HTMLElement) === ref.current) return; // our own toggle handles itself
      sync();
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".85rem", fontWeight: 600 }}>
      <input
        ref={ref}
        id={`${formId}-all`}
        type="checkbox"
        onChange={(e) => {
          const on = e.currentTarget.checked;
          for (const b of boxes()) b.checked = on;
          setCount(on ? boxes().length : 0);
          if (ref.current) ref.current.indeterminate = false;
        }}
      />
      <label htmlFor={`${formId}-all`} style={{ cursor: "pointer" }}>
        Select all
      </label>
      {count > 0 && <span className="muted" style={{ fontWeight: 400 }}>({count} ticked)</span>}
    </span>
  );
}
