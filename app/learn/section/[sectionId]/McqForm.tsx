"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { gradeMcqAttempt, type McqResult } from "./testActions";

type Question = { id: string; question: string; options: string[] };

function fmtClock(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function McqForm({
  sectionId,
  questions,
  minutesPerQuestion = 1,
  topicId,
  lockedResult = null,
}: {
  sectionId: string;
  questions: Question[];
  minutesPerQuestion?: number;
  topicId?: string;
  lockedResult?: (McqResult & { alreadyDone?: boolean }) | null;
}) {
  const totalSeconds = Math.max(1, Math.round(questions.length * minutesPerQuestion * 60));
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  // A student gets ONE attempt — if they already took it, we start on the report.
  const [result, setResult] = useState<(McqResult & { alreadyDone?: boolean }) | null>(lockedResult);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const submittedRef = useRef(!!lockedResult);

  const submit = useCallback(
    async (auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setBusy(true);
      try {
        const r = await gradeMcqAttempt({ sectionId, answers });
        if (r.ok) setResult(r);
        else {
          submittedRef.current = false;
          if (!auto) alert("Could not submit your test. Please try again.");
        }
      } finally {
        setBusy(false);
      }
    },
    [sectionId, answers],
  );

  // Countdown — auto-submits (without further checking) when time runs out.
  useEffect(() => {
    if (result) return;
    if (secondsLeft <= 0) {
      submit(true);
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, result, submit]);

  // ---------- RESULT / PERFORMANCE REPORT ----------
  if (result) {
    const pct = result.total ? Math.round(((result.score ?? 0) / result.total) * 100) : 0;
    const wrong = (result.review ?? []).filter((r) => !r.isCorrect);
    const right = (result.review ?? []).filter((r) => r.isCorrect);
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="card" style={{ border: "2px solid var(--accent)" }}>
          {result.alreadyDone && (
            <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
              📌 You have already taken this test once. Each test can be attempted only once — here is your report.
            </p>
          )}
          <h3 style={{ marginTop: 0 }}>{pct >= 60 ? "🎉 Well done!" : "📝 Keep practising!"}</h3>
          <p style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0" }}>
            {result.score} / {result.total} <span className="muted" style={{ fontSize: "1rem" }}>({pct}%)</span>
          </p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontWeight: 700 }}>
            <span>🏆 Your rank: #{result.rank ?? 1}</span>
            <span style={{ color: "#16a34a" }}>✅ {right.length} correct</span>
            <span style={{ color: "#dc2626" }}>❌ {wrong.length} wrong</span>
          </div>
          {(result.weakConcepts?.length ?? 0) > 0 && (
            <div style={{ margin: "12px 0 0" }}>
              <strong>🔎 Concepts to revise:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {result.weakConcepts!.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}
          {(result.classesToRedo?.length ?? 0) > 0 && (
            <div style={{ margin: "8px 0 0" }}>
              <strong>↩️ Classes to study again:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {result.classesToRedo!.map((cn) => (
                  <li key={cn}>
                    {topicId ? <Link href={`/learn/topic/${topicId}`} style={{ color: "var(--accent)", fontWeight: 700 }}>Class {cn}</Link> : `Class ${cn}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <a className="btn small secondary" href={`/learn/section/${sectionId}/paper`} target="_blank" rel="noopener noreferrer">⬇️ Question paper (PDF)</a>
            <a className="btn small secondary" href={`/learn/section/${sectionId}/answers`} target="_blank" rel="noopener noreferrer">⬇️ Answer key + explanations (PDF)</a>
          </div>
        </div>

        {(result.review ?? []).map((r, i) => (
          <div className="card" key={i} style={{ borderColor: r.isCorrect ? "#22c55e" : "#ef4444" }}>
            <p style={{ fontWeight: 600 }}>
              {i + 1}. {r.question}
              {r.sourceClassNo && <span className="muted" style={{ fontWeight: 400, fontSize: ".8rem" }}> · Class {r.sourceClassNo}</span>}
              {r.concept && <span className="muted" style={{ fontWeight: 400, fontSize: ".8rem" }}> · {r.concept}</span>}
            </p>
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
                {r.chosenIndex < 0 && <p style={{ margin: "0 0 6px", color: "#dc2626" }}>You didn&apos;t answer this one.</p>}
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

  // ---------- TEST IN PROGRESS ----------
  const q = questions[current];
  const answeredCount = Object.keys(answers).length;
  const lowTime = secondsLeft <= 60;

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1fr) 200px", alignItems: "start" }}>
      {/* Main question column */}
      <div style={{ display: "grid", gap: 14 }}>
        <div
          className="card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            position: "sticky",
            top: 8,
            zIndex: 2,
            border: lowTime ? "2px solid #ef4444" : "2px solid var(--accent)",
          }}
        >
          <strong>Question {current + 1} of {questions.length}</strong>
          <span style={{ fontWeight: 800, fontSize: "1.1rem", color: lowTime ? "#ef4444" : "var(--text)" }}>
            ⏱️ {fmtClock(secondsLeft)}
          </span>
        </div>

        {lowTime && (
          <div className="notice" style={{ background: "rgba(239,68,68,.12)", color: "#fca5a5", margin: 0 }}>
            ⚠️ Less than 1 minute left! The test will close and submit automatically — unanswered questions stay blank.
          </div>
        )}

        <div className="card">
          <p style={{ fontWeight: 600, marginBottom: 12 }}>{current + 1}. {q.question}</p>
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
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 8 }}>
            <button className="btn small secondary" type="button" disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>← Previous</button>
            {answers[q.id] !== undefined && (
              <button className="btn small secondary" type="button" onClick={() => setAnswers((a) => { const n = { ...a }; delete n[q.id]; return n; })}>Clear</button>
            )}
            <button className="btn small secondary" type="button" disabled={current === questions.length - 1} onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}>Next →</button>
          </div>
        </div>

        <button className="btn" type="button" disabled={busy} onClick={() => submit(false)}>
          {busy ? "Submitting…" : `Submit test ✅ (${answeredCount}/${questions.length} answered)`}
        </button>
      </div>

      {/* Question navigator — jump to any question, change answers freely */}
      <div className="card" style={{ position: "sticky", top: 8 }}>
        <strong style={{ fontSize: ".85rem" }}>Questions</strong>
        <p className="muted" style={{ fontSize: ".72rem", margin: "2px 0 8px" }}>Tap a number to jump. ✅ = answered.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
          {questions.map((qq, i) => {
            const answered = answers[qq.id] !== undefined;
            const isCur = i === current;
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => setCurrent(i)}
                title={answered ? "Answered" : "Not answered"}
                style={{
                  height: 34,
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: ".82rem",
                  cursor: "pointer",
                  border: isCur ? "2px solid var(--accent)" : "1px solid var(--border)",
                  background: answered ? "var(--accent)" : "var(--bg-soft)",
                  color: answered ? "#fff" : "var(--text)",
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: ".72rem", marginTop: 10, marginBottom: 0 }}>
          {answeredCount}/{questions.length} answered
        </p>
      </div>
    </div>
  );
}
