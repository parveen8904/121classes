"use client";

import { useEffect, useRef, useState } from "react";

// Tick every answer key at once. The row checkboxes are not children of the
// toolbar form — they attach to it by id — so this walks the document for them
// rather than the form's own subtree.
export default function SelectAllKeys({ formId, name }: { formId: string; name: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);

  function boxes(): HTMLInputElement[] {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"][form="${formId}"]`),
    );
  }

  // Keep the header box honest when rows are ticked individually: all ticked
  // shows ticked, some ticked shows the dash.
  useEffect(() => {
    const sync = () => {
      const all = boxes();
      const on = all.filter((b) => b.checked).length;
      setCount(on);
      if (ref.current) {
        ref.current.checked = on > 0 && on === all.length;
        ref.current.indeterminate = on > 0 && on < all.length;
      }
    };
    sync();
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".85rem", fontWeight: 600 }}>
      <input
        ref={ref}
        type="checkbox"
        onChange={(e) => {
          for (const b of boxes()) b.checked = e.target.checked;
          document.dispatchEvent(new Event("change"));
        }}
      />
      Select all
      {count > 0 && <span className="muted" style={{ fontWeight: 400 }}>({count} ticked)</span>}
    </label>
  );
}
