"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { mockInterview } from "../actions";

type Turn = { who: "interviewer" | "you"; text: string };

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pick a natural English voice for the interviewer — prefer Indian English,
// then any English. Voices load async in some browsers, hence the getter.
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  return (
    voices.find((v) => /en[-_]IN/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    voices[0] ??
    null
  );
}

export default function MockInterview() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState(false);
  const [practice, setPractice] = useState(false);
  const [error, setError] = useState("");

  // --- Spoken interview (browser speech, no server needed) -------------------
  const [voiceOn, setVoiceOn] = useState(true);        // interviewer speaks questions
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);   // student's mic dictation
  const [canListen, setCanListen] = useState(false);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const recRef = useRef<any>(null);
  const spokenCount = useRef(0);                       // interviewer turns already spoken

  const keepAlive = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlocked = useRef(false);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setCanListen(!!SR);
    // Warm the voice list (Chrome populates it async via voiceschanged).
    const synth = window.speechSynthesis;
    synth?.getVoices?.();
    synth?.addEventListener?.("voiceschanged", () => synth.getVoices());
    return () => {
      if (keepAlive.current) clearInterval(keepAlive.current);
      window.speechSynthesis?.cancel?.();
      try { recRef.current?.stop?.(); } catch { /* already stopped */ }
    };
  }, []);

  // Browsers only allow speech that a user gesture "unlocked". The first
  // question arrives AFTER an async server call, so we unlock synchronously
  // inside the button click with a silent utterance — then later speaks work
  // everywhere (including iPhone/iPad).
  function unlockSpeech() {
    if (unlocked.current) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
      unlocked.current = true;
    } catch { /* not supported */ }
  }

  function speak(text: string) {
    const synth = window.speechSynthesis;
    if (!synth || !text.trim()) return;
    synth.cancel();
    if (keepAlive.current) clearInterval(keepAlive.current);
    // Chrome stalls on long utterances (~15s) — split into sentence-sized
    // chunks and queue them; each chunk is short enough to finish reliably.
    const chunks: string[] = [];
    let buf = "";
    for (const part of text.replace(/\s+/g, " ").split(/(?<=[.!?।])\s+/)) {
      if ((buf + " " + part).trim().length > 200 && buf) { chunks.push(buf.trim()); buf = part; }
      else buf = (buf ? buf + " " : "") + part;
    }
    if (buf.trim()) chunks.push(buf.trim());
    const v = pickVoice();
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (v) u.voice = v;
      u.rate = 0.95;
      if (i === 0) u.onstart = () => setSpeaking(true);
      if (i === chunks.length - 1) { u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false); }
      // Chrome swallows a speak() issued immediately after cancel() — queue a
      // beat later. resume() first: Chrome can be stuck in a paused state.
      setTimeout(() => {
        try { synth.resume(); synth.speak(u); } catch { /* not supported */ }
      }, 120);
    });
  }

  // Speak each NEW interviewer turn as it arrives (when voice is on).
  useEffect(() => {
    const interviewerTurns = turns.filter((t) => t.who === "interviewer");
    if (interviewerTurns.length > spokenCount.current) {
      spokenCount.current = interviewerTurns.length;
      if (voiceOnRef.current) speak(interviewerTurns[interviewerTurns.length - 1].text);
    }
  }, [turns]);

  function toggleVoice() {
    setVoiceOn((on) => {
      if (on) { window.speechSynthesis?.cancel?.(); setSpeaking(false); }
      else {
        // Turning back on: read the latest question aloud.
        const last = [...turns].reverse().find((t) => t.who === "interviewer");
        if (last) speak(last.text);
      }
      return !on;
    });
  }

  // Dictate the answer with the browser's speech recognition (where supported).
  function toggleMic() {
    if (listening) { try { recRef.current?.stop?.(); } catch { /* noop */ } return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    window.speechSynthesis?.cancel?.(); // don't record the interviewer's voice
    setSpeaking(false);
    const rec = new SR();
    recRef.current = rec;
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript + " ";
      }
      if (text.trim()) setInput((prev) => (prev ? prev + " " : "") + text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  }

  const answers = turns.filter((t) => t.who === "you").length;

  function transcript(extra?: Turn[]): string {
    return [...turns, ...(extra ?? [])]
      .map((t) => `${t.who === "interviewer" ? "Interviewer" : "Candidate"}: ${t.text}`)
      .join("\n");
  }

  function begin() {
    unlockSpeech(); // inside the click — allows the async first question to be spoken
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
    unlockSpeech(); // keep speech allowed for the async reply
    const answer = input.trim();
    if (listening) { try { recRef.current?.stop?.(); } catch { /* noop */ } }
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
        <p>Ready when you are. The interviewer will <strong>ask questions aloud</strong> (browser voice) and you can
          <strong> speak your answers</strong> with the mic or type them — with feedback after each answer and a final assessment.</p>
        <label className="remember" style={{ margin: "10px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: ".82rem" }}>
            I agree that the answers I give here will be processed by the platform&apos;s AI service (Anthropic) to
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn small secondary" type="button" onClick={toggleVoice} title="Interviewer voice on/off">
          {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
        </button>
        {speaking && <span className="muted" style={{ fontSize: ".8rem" }}>🗣️ Interviewer is speaking…</span>}
      </div>
      {practice && (
        <p className="notice ok" style={{ margin: 0, fontSize: ".82rem" }}>
          🧪 Practice mode — standard questions without AI feedback right now. Your answers still make great practice.
        </p>
      )}
      {turns.map((t, i) => (
        <div key={i} className="card" style={{ background: t.who === "you" ? "var(--bg-soft)" : "var(--card)" }}>
          <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>{t.who === "interviewer" ? "🧑‍💼 Interviewer" : "🙋 You"}</p>
          <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{t.text}</p>
          {t.who === "interviewer" && (
            <button className="btn small secondary" type="button" onClick={() => speak(t.text)} style={{ marginTop: 6 }}>
              🔁 Hear again
            </button>
          )}
        </div>
      ))}

      {!done && (
        <div className="card">
          <textarea
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? "🎙️ Listening — speak your answer…" : "Speak with the mic or type your answer…"}
          />
          {error && <p className="notice err" style={{ margin: "8px 0" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {canListen && (
              <button
                className="btn secondary"
                type="button"
                onClick={toggleMic}
                disabled={pending}
                style={listening ? { background: "#dc2626", color: "#fff", borderColor: "transparent" } : undefined}
              >
                {listening ? "⏹ Stop mic" : "🎤 Speak answer"}
              </button>
            )}
            <button className="btn" type="button" onClick={() => send(false)} disabled={pending || !input.trim()}>
              {pending ? "…" : "Send answer"}
            </button>
            {answers >= 3 && (
              <button className="btn secondary" type="button" onClick={() => send(true)} disabled={pending}>
                Finish &amp; get assessment
              </button>
            )}
          </div>
          {!canListen && (
            <p className="muted" style={{ fontSize: ".75rem", marginTop: 6 }}>
              🎤 Voice answers need Chrome, Edge or Safari. You can always type instead.
            </p>
          )}
        </div>
      )}
      {done && <p className="muted" style={{ textAlign: "center" }}>Interview complete. Refresh the page to practise again.</p>}
    </div>
  );
}
