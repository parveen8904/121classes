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
}: {
  children: React.ReactNode;
  className?: string;
  savedLabel?: string;
  closeDetails?: boolean;
  style?: React.CSSProperties;
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
    <button ref={ref} className={className} type="submit" disabled={pending} aria-busy={pending} style={style}>
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
  );
}
