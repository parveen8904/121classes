"use client";

import { useEffect, useRef, useState } from "react";

// Full-screen secure player for a DOWNLOADED (decrypted) class. Custom controls
// so we can (a) keep the moving watermark visible even in fullscreen — we
// fullscreen the CONTAINER, not the <video>, so our overlay rides on top —
// and (b) add ⏪/⏩ seek and playback-speed control. Native <video> controls
// are OFF on purpose (their fullscreen button would strip the watermark).
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export default function OfflinePlayer({
  src,
  watermark,
  onClose,
}: {
  src: string;
  watermark?: string;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    const onTime = () => setCur(v.currentTime);
    const onMeta = () => setDur(v.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  const seek = (delta: number) => { const v = vidRef.current; if (v) v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta)); };
  const toggle = () => { const v = vidRef.current; if (!v) return; v.paused ? v.play() : v.pause(); };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    setRate(next);
    if (vidRef.current) vidRef.current.playbackRate = next;
  };
  const fullscreen = () => {
    const el = wrapRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  };

  const btn: React.CSSProperties = { background: "rgba(255,255,255,.14)", color: "#fff", border: 0, borderRadius: 8, padding: "8px 12px", fontSize: "1rem", fontWeight: 700, cursor: "pointer", minWidth: 44 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column" }}>
      <button type="button" onClick={onClose} style={{ ...btn, position: "absolute", top: "calc(10px + env(safe-area-inset-top))", right: 12, zIndex: 4 }}>✕ Close</button>

      {/* This container is what goes fullscreen — so the watermark stays visible. */}
      <div ref={wrapRef} style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", background: "#000", minHeight: 0 }}>
        <div style={{ position: "relative", flex: 1, minHeight: 0 }} onClick={toggle}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={vidRef} src={src} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
          {watermark && <span className="vwm">{watermark}</span>}
        </div>

        {/* Custom control bar (lives INSIDE the fullscreened container). */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", background: "rgba(0,0,0,.85)", flexWrap: "wrap" }}>
          <button type="button" onClick={toggle} style={btn}>{playing ? "⏸" : "▶️"}</button>
          <button type="button" onClick={() => seek(-10)} style={btn} title="Back 10s">⏪ 10</button>
          <button type="button" onClick={() => seek(10)} style={btn} title="Forward 10s">10 ⏩</button>
          <input
            type="range" min={0} max={dur || 0} value={cur} step="1"
            onChange={(e) => { const v = vidRef.current; if (v) v.currentTime = Number(e.target.value); }}
            style={{ flex: 1, minWidth: 120, accentColor: "#0d9488" }}
          />
          <span style={{ color: "#fff", fontSize: ".8rem", fontVariantNumeric: "tabular-nums", minWidth: 88, textAlign: "center" }}>{fmt(cur)} / {fmt(dur)}</span>
          <button type="button" onClick={cycleSpeed} style={btn} title="Playback speed">{rate}×</button>
          <button type="button" onClick={fullscreen} style={btn} title="Fullscreen">⛶</button>
        </div>
      </div>
    </div>
  );
}
