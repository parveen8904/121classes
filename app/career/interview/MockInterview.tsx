"use client";

import { useState, useTransition } from "react";
import { mockInterview } from "../actions";

type Turn = { who: "interviewer" | "you"; text: string };

export default function MockInterview() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  const answers = turns.filter((t) => t.who === "you").length;

  function transcript(extra?: Turn[]): string {
    return [...turns, ...(extra ?? [])]
      .map((t) => `${t.who === "interviewer" ? "Interviewer" : "Candidate"}: ${t.text}`)
      .join("\n");
  }

  function begin() {
    start(async () => {
      const r = await mockInterview("");
      if (r.text) setTurns([{ who: "interviewer", text: r.text }]);
      else alert(r.text || "Couldn't start — is the AI key set?");
    });
  }

  function send(end = false) {
    const mine: Turn[] = input.trim() ? [{ who: "you", text: input.trim() }] : [];
    const t = transcript(mine) + (end ? "\nEND INTERVIEW" : "");
    setTurns((prev) => [...prev, ...mine]);
    setInput("");
    start(async () => {
      const r = await mockInterview(t);
      if (r.text) {
        setTurns((prev) => [...prev, { who: "interviewer", text: r.text! }]);
        if (end) setDone(true);
      }
    });
  }

  if (turns.length === 0) {
    return (
      <div className="card">
        <p>Ready when you are. The interviewer will ask CA technical, practical and HR questions.</p>
        <button className="btn" type="button" onClick={begin} disabled={pending}>{pending ? "Starting…" : "Start interview 🎤"}</button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {turns.map((t, i) => (
        <div key={i} className="card" style={{ background: t.who === "you" ? "var(--bg-soft)" : "var(--card)" }}>
          <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>{t.who === "interviewer" ? "🧑‍💼 Interviewer" : "🙋 You"}</p>
          <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{t.text}</p>
        </div>
      ))}

      {!done && (
        <div className="card">
          <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your answer…" />
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
