"use client";

import { useState } from "react";
import CaseText from "@/app/components/CaseText";

type Q = { id: string; question: string; options: string[]; correct_index: number; explanation: string | null };

// Teaser case player: answer each MCQ, see right/wrong + the explanation
// immediately, and a score at the end. No account needed — this is the taste
// that sells the full bank.
export default function TryCasePlayer({ title, scenario, questions }: { title: string; scenario: string; questions: Q[] }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const answered = Object.keys(answers).length;
  const score = questions.reduce((n, q) => (answers[q.id] === q.correct_index ? n + 1 : n), 0);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card">
        <strong>🧩 {title}</strong>
        <CaseText text={scenario} fontSize=".92rem" />
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {questions.map((q, qi) => {
          const picked = answers[q.id];
          const done = picked !== undefined;
          return (
            <div className="card" key={q.id}>
              <strong style={{ fontSize: ".92rem" }}>Q{qi + 1}. {q.question}</strong>
              <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                {q.options.map((opt, i) => {
                  const isPick = picked === i;
                  const isRight = q.correct_index === i;
                  const bg = done ? (isRight ? "rgba(16,185,129,.15)" : isPick ? "rgba(239,68,68,.15)" : "transparent") : "transparent";
                  return (
                    <button
                      key={i}
                      disabled={done}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                      style={{
                        textAlign: "left", padding: "8px 12px", borderRadius: 8, cursor: done ? "default" : "pointer",
                        border: `1px solid ${done && isRight ? "#10b981" : done && isPick ? "#ef4444" : "var(--border)"}`,
                        background: bg, color: "inherit", fontSize: ".88rem",
                      }}
                    >
                      {String.fromCharCode(65 + i)}. {opt}
                      {done && isRight ? " ✅" : done && isPick ? " ❌" : ""}
                    </button>
                  );
                })}
              </div>
              {done && q.explanation && (
                <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>💡 {q.explanation}</p>
              )}
            </div>
          );
        })}
      </div>

      {answered === questions.length && questions.length > 0 && (
        <div className="notice ok" style={{ marginTop: 14, textAlign: "center", fontSize: "1rem" }}>
          🎯 Your score: <strong>{score} / {questions.length}</strong>
          {score === questions.length ? " — perfect! You're ready for tougher ones." : " — the full bank will sharpen this fast."}
        </div>
      )}
    </div>
  );
}
