"use client";

import { useState, useTransition } from "react";
import { mockInterview } from "../actions";

type Turn = { who: "interviewer" | "you"; text: string };

export default function MockInterview() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState(false);
  const [practice, setPractice] = useState(false);
  const [error, setError] = useState("");

  const answers = turns.filter((t) => t.who === "you").length;

  function transcript(extra?: Turn[]): string {
    return [...turns, ...(extra ?? [])]
      .map((t) => `${t.who === "interviewer" ? "Interviewer" : "Candidate"}: ${t.text}`)
      .join("\n");
  }

  function begin() {
    setError("");
    start(async () => {
      try {
        const r = await mockInterview("");
        if (r.ok) {
          setTurns([{ who: "interviewer", text: r.text }]);
          setPractice(Boolean(r.practice));
        } else {
          setError(r.text || "Couldn't start the interview — please try again.");
        }
      } catch {
        setError("Couldn't reach the server — check your connection and try again.");
      }
    });
  }

  function send(end = false) {
    const answer = input.trim();
    const mine: Turn[] = answer ? [{ who: "you", text: answer }] : [];
    const t = transcript(mine) + (end ? "\nEND INTERVIEW" : "");
    setTurns((prev) => [...prev, ...mine]);
    setInput("");
    setError("");
    start(async () => {
      try {
        const r = await mockInterview(t);
        if (r.ok) {
          setTurns((prev) => [...prev, { who: "interviewer", text: r.text }]);
          setPractice(Boolean(r.practice));
          if (end) setDone(true);
        } else {
          setInput(answer); // give the answer back so nothing is lost
          setError(r.text || "Couldn't get a reply — please send again.");
        }
      } catch {
        setInput(answer);
        setError("Couldn't reach the server — check your connection and send again.");
      }
    });
  }

  if (turns.length === 0) {
    return (
      <div className="card">
        <p>Ready when you are. The interviewer will ask CA technical, practical and HR questions — you&apos;ll get feedback after each answer and a final assessment.</p>
        <label className="remember" style={{ margin: "10px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: ".82rem" }}>
            I agree that the answers I type here will be processed by the platform&apos;s AI service (Anthropic) to
            generate interview questions and feedback. My answers are not used to train AI models. See the{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
          </span>
        </label>
        {error && <p className="notice err" style={{ marginBottom: 10 }}>{error}</p>}
        <button className="btn" type="button" onClick={begin} disabled={pending || !consent}>
          {pending ? "Starting…" : "Start interview 🎤"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {practice && (
        <p className="notice ok" style={{ margin: 0, fontSize: ".82rem" }}>
          🧪 Practice mode — standard questions without AI feedback right now. Your answers still make great practice.
        </p>
      )}
      {turns.map((t, i) => (
        <div key={i} className="card" style={{ background: t.who === "you" ? "var(--bg-soft)" : "var(--card)" }}>
          <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>{t.who === "interviewer" ? "🧑‍💼 Interviewer" : "🙋 You"}</p>
          <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{t.text}</p>
        </div>
      ))}

      {!done && (
        <div className="card">
          <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your answer…" />
          {error && <p className="notice err" style={{ margin: "8px 0" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => send(false)} disabled={pending || !input.trim()}>
              {pending ? "…" : "Send answer"}
            </button>
            {answers >= 3 && (
              <button className="btn secondary" type="button" onClick={() => send(true)} disabled={pending}>
                Finish &amp; get assessment
              </button>
            )}
          </div>
        </div>
      )}
      {done && <p className="muted" style={{ textAlign: "center" }}>Interview complete. Refresh the page to practise again.</p>}
    </div>
  );
}
