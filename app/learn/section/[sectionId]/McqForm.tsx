"use client";

import { useState } from "react";
import { gradeMcqAttempt, type McqReview } from "./testActions";

type Question = { id: string; question: string; options: string[] };

export default function McqForm({ sectionId, questions }: { sectionId: string; questions: Question[] }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number; review: McqReview[] } | null>(null);

  async function submit() {
    setBusy(true);
    try {
      const r = await gradeMcqAttempt({ sectionId, answers });
      if (r.ok) setResult({ score: r.score ?? 0, total: r.total ?? questions.length, review: r.review ?? [] });
      else alert("Could not submit your test. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="card">
          <h3>{pct >= 60 ? "🎉 Well done!" : "📝 Keep practising!"}</h3>
          <p style={{ fontSize: "1.4rem", fontWeight: 800, margin: "8px 0" }}>
            {result.score} / {result.total} <span className="muted" style={{ fontSize: "1rem" }}>({pct}%)</span>
          </p>
          <button className="btn small secondary" type="button" onClick={() => { setResult(null); setAnswers({}); }}>
            Try again
          </button>
        </div>

        {result.review.map((r, i) => (
          <div className="card" key={i} style={{ borderColor: r.isCorrect ? "#22c55e" : "#ef4444" }}>
            <p style={{ fontWeight: 600 }}>{i + 1}. {r.question}</p>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {r.options.map((opt, oi) => {
                const isCorrect = oi === r.correctIndex;
                const isChosenWrong = oi === r.chosenIndex && !r.isCorrect;
                return (
                  <div
                    key={oi}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      background: isCorrect ? "rgba(34,197,94,.12)" : isChosenWrong ? "rgba(239,68,68,.12)" : "transparent",
                      fontWeight: isCorrect ? 700 : 400,
                    }}
                  >
                    {isCorrect ? "✅ " : isChosenWrong ? "❌ " : ""}
                    {opt}
                  </div>
                );
              })}
            </div>
            {r.isCorrect ? (
              <p style={{ marginTop: 10, color: "#16a34a" }}>✓ Correct.{r.whyCorrect ? ` ${r.whyCorrect}` : ""}</p>
            ) : (
              <div style={{ marginTop: 10 }}>
                {r.whyChosenWrong && <p style={{ margin: "0 0 6px", color: "#dc2626" }}>Why your choice is wrong: {r.whyChosenWrong}</p>}
                <p style={{ margin: 0 }}>
                  <strong>Correct answer:</strong> {r.options[r.correctIndex]}
                  {r.whyCorrect ? ` — ${r.whyCorrect}` : ""}
                </p>
              </div>
            )}
          </div>
        ))}
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
