"use client";

import { useState } from "react";
import { askDoubt } from "../../section/[sectionId]/testActions";

export default function DoubtBox({ sectionId }: { sectionId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(null);
    setPending(false);
    try {
      const r = await askDoubt({ sectionId, question });
      if (!r.ok) {
        alert("Could not submit your doubt. Please try again.");
        return;
      }
      if (r.answer) setAnswer(r.answer);
      else setPending(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <textarea
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Type your doubt — e.g. How is goodwill treated here?"
      />
      <button className="btn small" type="button" disabled={busy || !question.trim()} onClick={ask}>
        {busy ? "Thinking…" : "Ask 💬"}
      </button>

      {answer && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted" style={{ fontSize: ".78rem", marginBottom: 6 }}>🤖 AI assistant</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{answer}</p>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 10 }}>
            Guided by CA Parveen Sharma&apos;s team. Double-check anything important with your faculty.
          </p>
        </div>
      )}
      {pending && (
        <p className="muted" style={{ marginTop: 10, fontSize: ".88rem" }}>
          ✅ Submitted! Our faculty will review your doubt and respond soon.
        </p>
      )}
    </div>
  );
}
