"use client";

import { useState, useTransition } from "react";
import { getSuggestedAnswer } from "./suggested-actions";

// Per-item tools: reveal a suggested answer (subjective), and share externally
// (Gmail compose, native share, print/PDF).
export default function PaperTools({
  questionId,
  shareTitle,
  shareText,
}: {
  questionId?: string;
  shareTitle: string;
  shareText: string;
}) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function suggest() {
    if (!questionId) return;
    setErr(null);
    start(async () => {
      const r = await getSuggestedAnswer(questionId);
      if (r.ok && r.answer) setAnswer(r.answer);
      else setErr("Couldn't generate a suggested answer right now.");
    });
  }

  function gmail() {
    const url =
      "https://mail.google.com/mail/?view=cm&fs=1&su=" +
      encodeURIComponent(shareTitle) +
      "&body=" +
      encodeURIComponent(shareText + (answer ? `\n\nSuggested answer:\n${answer}` : ""));
    window.open(url, "_blank", "noopener");
  }

  async function share() {
    const text = shareText + (answer ? `\n\nSuggested answer:\n${answer}` : "");
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
        {questionId && (
          <button className="btn small secondary" type="button" onClick={suggest} disabled={pending}>
            {pending ? "Preparing…" : "💡 Suggested answer"}
          </button>
        )}
        <button className="btn small secondary" type="button" onClick={gmail}>📧 Email (Gmail)</button>
        <button className="btn small secondary" type="button" onClick={share}>🔗 Share</button>
        <button className="btn small secondary" type="button" onClick={() => window.print()}>🖨️ Print / PDF</button>
      </div>
      {err && <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>{err}</p>}
      {answer && (
        <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: "3px solid var(--accent)" }}>
          <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>💡 Suggested model answer</p>
          <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{answer}</p>
        </div>
      )}
    </div>
  );
}
