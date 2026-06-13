"use client";

import { useState } from "react";
import { submitSubjective } from "./testActions";

type Question = { id: string; prompt: string; max_marks: number | null };
type Result = { status: string; score: number | null; feedback: string };

function QuestionItem({ q, index }: { q: Question; index: number }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit() {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      const r = await submitSubjective({ questionId: q.id, answer });
      if (r.ok) setResult({ status: r.status, score: r.score, feedback: r.feedback });
      else alert("Could not submit. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p style={{ fontWeight: 600 }}>
        {index + 1}. {q.prompt}{" "}
        {q.max_marks != null && <span className="muted" style={{ fontSize: ".85rem" }}>({q.max_marks} marks)</span>}
      </p>
      {result ? (
        <div style={{ marginTop: 12 }}>
          {result.status === "graded" && result.score != null && (
            <p style={{ fontWeight: 800, fontSize: "1.1rem" }}>
              🧮 Score: {result.score}
              {q.max_marks != null ? ` / ${q.max_marks}` : ""}
            </p>
          )}
          <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{result.feedback}</p>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <textarea
            rows={5}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write your answer here…"
          />
          <button className="btn small" type="button" disabled={busy || !answer.trim()} onClick={submit}>
            {busy ? "Submitting…" : "Submit answer ✍️"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SubjectiveForm({ questions }: { questions: Question[] }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {questions.map((q, i) => (
        <QuestionItem key={q.id} q={q} index={i} />
      ))}
    </div>
  );
}
