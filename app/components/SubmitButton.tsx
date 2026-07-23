"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// Drop-in submit button for any <form action={serverAction}>. Shows a spinner +
// "Saving…" while the action runs, then "✓ Saved" briefly, and can collapse the
// surrounding <details> on success so the user knows it's done.
export default function SubmitButton({
  children,
  className = "btn",
  savedLabel = "✓ Saved",
  closeDetails = false,
  style,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  savedLabel?: string;
  closeDetails?: boolean;
  style?: React.CSSProperties;
  /** Optional form field submitted when THIS button is the one clicked. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const [saved, setSaved] = useState(false);
  const wasPending = useRef(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (wasPending.current && !pending) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2500);
      if (closeDetails) {
        const d = ref.current?.closest("details");
        if (d) (d as HTMLDetailsElement).open = false;
      }
      wasPending.current = false;
      return () => clearTimeout(t);
    }
    wasPending.current = pending;
  }, [pending, closeDetails]);

  return (
    <>
      <button ref={ref} className={className} type="submit" disabled={pending} aria-busy={pending} style={style} name={name} value={value}>
        {pending ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="btn-spinner" aria-hidden="true" /> Saving…
          </span>
        ) : saved ? (
          savedLabel
        ) : (
          children
        )}
      </button>
      {/* Unmissable confirmation — a floating toast, not just the button flip. */}
      {saved && (
        <span
          role="status"
          style={{
            position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)",
            background: "#16a34a", color: "#fff", padding: "10px 22px", borderRadius: 999,
            fontWeight: 700, zIndex: 9999, boxShadow: "0 6px 24px rgba(0,0,0,.25)",
            fontSize: ".92rem", whiteSpace: "nowrap",
          }}
        >
          {savedLabel} successfully
        </span>
      )}
    </>
  );
}
