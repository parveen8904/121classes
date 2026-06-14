"use client";

import { useState } from "react";

// A small "?" badge that reveals a plain-language explanation. Works on hover
// (desktop) and tap (mobile). Use beside any button/section that may confuse a
// student or admin: <Help text="What this does and how to use it." />
export default function Help({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help-wrap">
      <button
        type="button"
        className="help-q"
        aria-label={label || "What is this?"}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && <span className="help-tip" role="tooltip">{text}</span>}
    </span>
  );
}
