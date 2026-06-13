"use client";

import { useState } from "react";
import { gradeMcqAttempt } from "./testActions";

type Question = { id: string; question: string; options: string[] };

export default function McqForm({ sectionId, questions }: { sectionId: string; questions: Question[] }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  async function submit() {
    setBusy(true);
    try {
      const r = await gradeMcqAttempt({ sectionId, answers });
      if (r.ok) setResult({ score: r.score ?? 0, total: r.total ?? questions.length });
      else alert("Could not submit your test. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div className="card">
        <h3>{pct >= 60 ? "🎉 Well done!" : "📝 Keep practising!"}</h3>
        <p style={{ fontSize: "1.4rem", fontWeight: 800, margin: "8px 0" }}>
          {result.score} / {result.total} <span className="muted" style={{ fontSize: "1rem" }}>({pct}%)</span>
        </p>
        <button className="btn small secondary" type="button" onClick={() => { setResult(null); setAnswers({}); }}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {questions.map((q, qi) => (
        <div className="card" key={q.id}>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>
            {qi + 1}. {q.question}
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {q.options.map((opt, oi) => (
              <label key={oi} className="remember" style={{ margin: 0, cursor: "pointer" }}>
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  checked={answers[q.id] === oi}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                />{" "}
                {opt}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div>
        <button
          className="btn"
          type="button"
          disabled={busy || Object.keys(answers).length < questions.length}
          onClick={submit}
        >
          {busy ? "Checking…" : "Submit test ✅"}
        </button>
        {Object.keys(answers).length < questions.length && (
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 8 }}>
            Answer all {questions.length} questions to submit.
          </p>
        )}
      </div>
    </div>
  );
}
