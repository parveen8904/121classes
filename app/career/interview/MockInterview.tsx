"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { mockInterview } from "../actions";

type Turn = { who: "interviewer" | "you"; text: string };

/* eslint-disable @typescript-eslint/no-explicit-any */

// Rank voices for a natural INDIAN interviewer. Every device ships different
// voices, so score what's available: Indian-English "Natural/Neural" voices
// (Edge: Neerja/Prabhat) → Google en-IN → premium/enhanced en-IN → any en-IN →
// natural any-English → the rest. The student can still override via the picker.
function voiceScore(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  const isIN = /en[-_]in/i.test(v.lang);
  const natural = /natural|neural|premium|enhanced/.test(name);
  const google = name.includes("google");
  if (isIN && natural) return 100;
  if (isIN && google) return 90;
  if (isIN) return 80;
  if (/^en/i.test(v.lang) && natural) return 60;
  if (/^en/i.test(v.lang) && google) return 50;
  if (/^en/i.test(v.lang)) return 40;
  return 0;
}

function bestVoices(): SpeechSynthesisVoice[] {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  return voices
    .filter((v) => voiceScore(v) > 0)
    .sort((a, b) => voiceScore(b) - voiceScore(a));
}

// Make the text sound like a person: drop emoji/markdown the engine would read
// out ("asterisk asterisk…"), expand a few abbreviations, keep punctuation for
// natural pauses.
function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")     // emoji
    .replace(/[*_#`>~|]+/g, " ")                                          // markdown
    .replace(/\be\.g\.\s*/gi, "for example, ")
    .replace(/\bi\.e\.\s*/gi, "that is, ")
    .replace(/\bvs\.?\b/gi, "versus")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string>("");   // student's choice (persisted)
  const voiceNameRef = useRef(voiceName);
  voiceNameRef.current = voiceName;

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setCanListen(!!SR);
    // Voice list loads async in Chrome — refresh on voiceschanged.
    const synth = window.speechSynthesis;
    const load = () => {
      const vs = bestVoices();
      setVoices(vs);
      const saved = localStorage.getItem("interviewVoice");
      if (saved && vs.some((v) => v.name === saved)) setVoiceName(saved);
      else if (vs.length && !voiceNameRef.current) setVoiceName(vs[0].name);
    };
    load();
    synth?.addEventListener?.("voiceschanged", load);
    return () => {
      synth?.removeEventListener?.("voiceschanged", load);
      if (keepAlive.current) clearInterval(keepAlive.current);
      synth?.cancel?.();
      try { recRef.current?.stop?.(); } catch { /* already stopped */ }
    };
  }, []);

  function chooseVoice(name: string) {
    setVoiceName(name);
    try { localStorage.setItem("interviewVoice", name); } catch { /* private mode */ }
    const v = window.speechSynthesis?.getVoices?.().find((x) => x.name === name);
    if (v) {
      // Short sample so the student instantly hears the new voice.
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance("Hello, I will be your interviewer today.");
      u.voice = v; u.rate = 0.92;
      setTimeout(() => window.speechSynthesis.speak(u), 120);
    }
  }

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
    const cleaned = cleanForSpeech(text);
    if (!synth || !cleaned) return;
    synth.cancel();
    if (keepAlive.current) clearInterval(keepAlive.current);
    // Chrome stalls on long utterances (~15s) — split into sentence-sized
    // chunks and queue them; each chunk is short enough to finish reliably,
    // and the tiny gap between chunks doubles as a natural breath pause.
    const chunks: string[] = [];
    let buf = "";
    for (const part of cleaned.split(/(?<=[.!?।])\s+/)) {
      if ((buf + " " + part).trim().length > 200 && buf) { chunks.push(buf.trim()); buf = part; }
      else buf = (buf ? buf + " " : "") + part;
    }
    if (buf.trim()) chunks.push(buf.trim());
    const all = window.speechSynthesis?.getVoices?.() ?? [];
    const v = all.find((x) => x.name === voiceNameRef.current) ?? bestVoices()[0] ?? null;
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (v) u.voice = v;
      u.rate = 0.92;   // measured, interviewer-like pace
      u.pitch = 1.0;
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

  // --- Pre-interview voice check: ask the student's permission for the mic and
  // confirm the speaker works BEFORE starting (no surprise browser prompts).
  const [speakerOk, setSpeakerOk] = useState(false);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const [micState, setMicState] = useState<"idle" | "granted" | "denied" | "skipped">("idle");

  function testSpeaker() {
    unlockSpeech();
    setSpeakerTesting(true);
    const synth = window.speechSynthesis;
    if (!synth) { setSpeakerTesting(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance("Hello! I will be your interviewer today. If you can hear me clearly, tap the button that says I can hear.");
    const v = bestVoices()[0];
    if (v) u.voice = v;
    u.rate = 0.92;
    u.onend = () => setSpeakerTesting(false);
    u.onerror = () => setSpeakerTesting(false);
    setTimeout(() => { try { synth.resume(); synth.speak(u); } catch { setSpeakerTesting(false); } }, 120);
  }

  async function askMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // permission is what we wanted, not the stream
      setMicState("granted");
    } catch {
      setMicState("denied");
    }
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
    const micDecided = micState === "granted" || micState === "skipped" || micState === "denied" || !canListen;
    const ready = consent && speakerOk && micDecided;
    return (
      <div className="card">
        <p>Ready when you are. The interviewer will <strong>ask questions aloud</strong> (browser voice) and you can
          <strong> speak your answers</strong> with the mic or type them — with feedback after each answer and a final assessment.</p>

        {/* Step 1 — AI consent */}
        <label className="remember" style={{ margin: "10px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: ".82rem" }}>
            I agree that the answers I give here will be processed by the platform&apos;s AI service (Anthropic) to
            generate interview questions and feedback. My answers are not used to train AI models. See the{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
          </span>
        </label>

        {/* Step 2 — speaker check (interviewer speaks; student confirms they heard) */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <strong style={{ fontSize: ".9rem" }}>🔊 Step 1 · Speaker check</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px" }}>
            The interviewer speaks questions aloud — play the test and confirm you can hear it. (Phone not on silent, volume up.)
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn small secondary" type="button" onClick={testSpeaker} disabled={speakerTesting}>
              {speakerTesting ? "🗣️ Speaking…" : "▶ Play test voice"}
            </button>
            {speakerOk ? (
              <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>✓ Speaker working</span>
            ) : (
              <button className="btn small" type="button" onClick={() => setSpeakerOk(true)}>👍 I can hear</button>
            )}
          </div>
        </div>

        {/* Step 3 — microphone permission (explicitly asked, never a surprise) */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
          <strong style={{ fontSize: ".9rem" }}>🎤 Step 2 · Microphone permission</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px" }}>
            To speak your answers, the browser needs your permission to use the microphone. Your voice is converted to
            text on your device/browser; only the text is sent for feedback. You can also skip this and type.
          </p>
          {!canListen ? (
            <span className="muted" style={{ fontSize: ".85rem" }}>This browser doesn&apos;t support voice answers — you&apos;ll type instead (Chrome, Edge or Safari support it).</span>
          ) : micState === "granted" ? (
            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>✓ Microphone allowed</span>
          ) : micState === "denied" ? (
            <span style={{ color: "#dc2626", fontWeight: 600, fontSize: ".85rem" }}>✗ Microphone blocked — you can still type your answers. (Allow it from the browser&apos;s address-bar settings to speak.)</span>
          ) : micState === "skipped" ? (
            <span className="muted" style={{ fontWeight: 600, fontSize: ".85rem" }}>Skipped — you&apos;ll type your answers. <button type="button" className="btn small secondary" onClick={askMic} style={{ marginLeft: 6 }}>Allow mic instead</button></span>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn small" type="button" onClick={askMic}>Allow microphone</button>
              <button className="btn small secondary" type="button" onClick={() => setMicState("skipped")}>Skip — I&apos;ll type</button>
            </div>
          )}
        </div>

        {error && <p className="notice err" style={{ marginBottom: 10 }}>{error}</p>}
        <button className="btn" type="button" onClick={begin} disabled={pending || !ready}>
          {pending ? "Starting…" : "Start interview 🎤"}
        </button>
        {!ready && (
          <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>
            {!consent ? "Tick the consent box" : !speakerOk ? "Confirm you can hear the test voice" : "Choose Allow or Skip for the microphone"} to begin.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn small secondary" type="button" onClick={toggleVoice} title="Interviewer voice on/off">
          {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
        </button>
        {voiceOn && voices.length > 1 && (
          <select
            value={voiceName}
            onChange={(e) => chooseVoice(e.target.value)}
            style={{ fontSize: ".8rem", padding: "6px 8px", maxWidth: 220, marginBottom: 0 }}
            title="Interviewer's voice — pick the one that sounds most natural on your device"
          >
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {/en[-_]in/i.test(v.lang) ? "🇮🇳 " : ""}{v.name.replace(/^Microsoft |^Google /, "")}
              </option>
            ))}
          </select>
        )}
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
