"use client";

import { useEffect, useRef, useState } from "react";

// Full-screen secure player for a DOWNLOADED (decrypted) class. Custom controls
// so we can (a) keep the moving watermark visible even in fullscreen — we
// fullscreen the CONTAINER, not the <video>, so our overlay rides on top —
// and (b) add ⏪/⏩ seek and playback-speed control. Native <video> controls
// are OFF on purpose (their fullscreen button would strip the watermark).
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

// Where the player is actually reading from. A downloaded class MUST be on the
// device; anything else is the bug.
function srcKind(src: string): string {
  if (!src) return "no source";
  if (src.startsWith("blob:")) return "device (blob)";
  if (src.includes("_capacitor_file_")) return "device (app file)";
  if (src.startsWith("file:")) return "device (file)";
  if (/^https?:/i.test(src)) return `NETWORK (${new URL(src).host}) — not the device`;
  return src.slice(0, 40);
}

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
  // WHAT ACTUALLY WENT WRONG, on screen.
  //
  // "It stopped when I turned on aeroplane mode" can mean the file was never
  // local, or the player lost its source, or a decrypt that never finished.
  // Guessing between those from a description wastes a day per attempt, so the
  // player now says which one it was, on the device, at the moment it happens.
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    const onTime = () => setCur(v.currentTime);
    const onMeta = () => setDur(v.duration || 0);
    const onPlay = () => { setPlaying(true); setFault(null); };
    const onPause = () => setPlaying(false);
    const ERR: Record<number, string> = {
      1: "playback was aborted",
      2: "NETWORK ERROR — the player went to the network for this file, which means it is not being read from the device",
      3: "the file could not be decoded (the decrypted copy may be incomplete)",
      4: "the source was rejected or is missing",
    };
    const onErr = () => {
      const code = v.error?.code ?? 0;
      setFault(`${ERR[code] ?? "unknown error"} (code ${code}) · source: ${srcKind(src)}`);
    };
    const onStall = () => setFault(`stalled waiting for data · source: ${srcKind(src)}`);
    v.addEventListener("error", onErr);
    v.addEventListener("stalled", onStall);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("error", onErr);
      v.removeEventListener("stalled", onStall);
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
  // Fullscreen behaves the same here as it does for a streamed class. It did
  // not before: a downloaded class went fullscreen upright, so a 16:9 lecture
  // sat as a strip between two black bands, and this player's control bar never
  // retired — which is exactly why fullscreen "works in the normal player but
  // not through the download".
  const [isFull, setIsFull] = useState(false);
  const [selfRotate, setSelfRotate] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpChrome = () => {
    setShowChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowChrome(false), 2800);
  };

  useEffect(() => {
    const onChange = () => {
      const on = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
      setIsFull(on);
      const orientation = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
      if (!on) {
        try { orientation?.unlock?.(); } catch { /* nothing to unlock */ }
        setSelfRotate(false); setShowChrome(true);
        return;
      }
      bumpChrome();
      // Android turns the screen; iOS has no orientation lock at all, so the
      // picture is turned instead.
      const portrait = window.innerHeight > window.innerWidth;
      const lock = orientation?.lock;
      if (!lock) { setSelfRotate(portrait); return; }
      try {
        Promise.resolve(lock.call(orientation, "landscape"))
          .then(() => setSelfRotate(false))
          .catch(() => setSelfRotate(window.innerHeight > window.innerWidth));
      } catch { setSelfRotate(portrait); }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

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
      <div
        ref={wrapRef}
        className={`offline-stage${isFull && selfRotate ? " fs-rotate" : ""}`}
        style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", background: "#000", minHeight: 0 }}
        onPointerDown={() => { if (isFull) bumpChrome(); }}
      >
        <div style={{ position: "relative", flex: 1, minHeight: 0 }} onClick={toggle}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={vidRef} src={src} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
          {watermark && <span className="vwm">{watermark}</span>}

          {/* Only ever seen when something breaks — and then it says WHAT. */}
          {fault && (
            <div style={{
              position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 5,
              background: "rgba(127,29,29,.94)", color: "#fff", borderRadius: 10,
              padding: "10px 12px", fontSize: ".82rem", lineHeight: 1.5,
            }}>
              ⚠️ {fault}
              <div style={{ opacity: 0.75, marginTop: 4, fontSize: ".75rem", wordBreak: "break-all" }}>{src.slice(0, 120)}</div>
            </div>
          )}
        </div>

        {/* Custom control bar (lives INSIDE the fullscreened container). */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px calc(10px + env(safe-area-inset-bottom))",
          background: "rgba(0,0,0,.85)", flexWrap: "wrap",
          // Out of the way while watching, back on a tap — the same as the
          // streamed player, so the two feel like one app.
          opacity: isFull && !showChrome ? 0 : 1,
          pointerEvents: isFull && !showChrome ? "none" : "auto",
          transition: "opacity .25s ease",
        }}>
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
