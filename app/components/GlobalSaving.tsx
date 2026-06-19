"use client";

import { useEffect, useState } from "react";

// Site-wide safety net: the instant ANY form is submitted, show a "Saving…"
// pill and spin the clicked button — so the user always knows something is
// happening, even on forms that don't use <SubmitButton>. When the server
// action finishes it revalidates the page, React re-renders the button fresh
// (spinner clears) and the pill auto-hides.
export default function GlobalSaving() {
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    function onSubmit(e: Event) {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement)) return;
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
      if (btn) btn.classList.add("is-saving");
      setSaving(true);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setSaving(false), 6000);
    }
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  if (!saving) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#0d9488",
        color: "#fff",
        padding: "7px 16px",
        borderRadius: 999,
        boxShadow: "0 4px 14px rgba(0,0,0,.18)",
        fontSize: ".85rem",
        fontWeight: 600,
      }}
    >
      <span className="btn-spinner" style={{ borderTopColor: "#fff", borderRightColor: "rgba(255,255,255,.4)", borderBottomColor: "rgba(255,255,255,.4)", borderLeftColor: "rgba(255,255,255,.4)" }} aria-hidden="true" />
      Saving…
    </div>
  );
}
