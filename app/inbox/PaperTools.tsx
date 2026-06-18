"use client";

import { useState } from "react";

// Per-paper tools: reveal the pre-saved suggested answer, and share externally
// (Gmail compose, native share, print/PDF). No AI at view time.
export default function PaperTools({
  suggested,
  shareTitle,
  shareText,
}: {
  suggested?: string;
  shareTitle: string;
  shareText: string;
}) {
  const [show, setShow] = useState(false);

  function gmail() {
    const url =
      "https://mail.google.com/mail/?view=cm&fs=1&su=" +
      encodeURIComponent(shareTitle) +
      "&body=" +
      encodeURIComponent(shareText + (suggested ? `\n\nSuggested answer:\n${suggested}` : ""));
    window.open(url, "_blank", "noopener");
  }

  async function share() {
    const text = shareText + (suggested ? `\n\nSuggested answer:\n${suggested}` : "");
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text });
        return;
      } catch {
        /* cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied — you can paste it anywhere.");
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {suggested && (
          <button className="btn small secondary" type="button" onClick={() => setShow((v) => !v)}>
            {show ? "Hide suggested answer" : "💡 Suggested answer"}
          </button>
        )}
        <button className="btn small secondary" type="button" onClick={gmail}>📧 Email (Gmail)</button>
        <button className="btn small secondary" type="button" onClick={share}>🔗 Share</button>
        <button className="btn small secondary" type="button" onClick={() => window.print()}>🖨️ Print / PDF</button>
      </div>
      {suggested && show && (
        <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: "3px solid var(--accent)" }}>
          <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>💡 Suggested model answer</p>
          <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{suggested}</p>
        </div>
      )}
    </div>
  );
}
