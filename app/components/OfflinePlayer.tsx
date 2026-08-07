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
  // FULLSCREEN, WITHOUT THE FULLSCREEN API.
  //
  // This player is already the whole screen — the overlay below is
  // position:fixed, inset:0. Asking WebKit for fullscreen on a child of it was
  // redundant, and it caused all three faults at once:
  //
  //  · the ✕ Close button sits OUTSIDE the element that went fullscreen, so it
  //    vanished the moment fullscreen began — and never faded when it did not;
  //  · the control bar only faded when `isFull` was true, so on a player that
  //    is visually always fullscreen the bar simply never went away. That is
  //    "the controls continue to remain";
  //  · and none of it fired at all if the fullscreen request was refused,
  //    which on a downloaded file inside a WKWebView it often is.
  //
  // So: no fullscreen request. The chrome — close button and control bar
  // together — retires on its own while the class plays, and one tap brings it
  // back. ⛶ turns the picture a quarter turn when the phone is upright, which
  // is what fills the screen on a phone nobody wants to rotate.
  const [chrome, setChrome] = useState(true);
  const [turned, setTurned] = useState(false);
  const [portrait, setPortrait] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showChrome = () => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Only retire while something is actually playing — a paused video with no
    // controls looks like a frozen app.
    hideTimer.current = setTimeout(() => { if (!vidRef.current?.paused) setChrome(false); }, 3000);
  };

  useEffect(() => {
    showChrome();
    const onResize = () => setPortrait(window.innerHeight > window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Tapping the picture shows or hides the chrome — it does NOT pause. Tapping
  // to see the controls and pausing the class by accident is its own small
  // annoyance, and no other video player does it.
  const tapPicture = () => {
    if (chrome) { setChrome(false); if (hideTimer.current) clearTimeout(hideTimer.current); }
    else showChrome();
  };

  // Turn the picture a quarter turn so a 16:9 class fills an upright phone,
  // instead of sitting as a strip between two black bands. On a phone already
  // held sideways there is nothing to turn.
  const toggleTurn = () => {
    const next = !turned;
    setTurned(next);
    showChrome();
    if (next) {
      // Ask the phone to rotate as well — Android obliges, iOS refuses, and the
      // turn above covers iOS either way.
      const o = (screen as unknown as { orientation?: { lock?: (x: string) => Promise<void>; unlock?: () => void } }).orientation;
      try { Promise.resolve(o?.lock?.("landscape")).catch(() => {}); } catch { /* not supported */ }
    } else {
      const o = (screen as unknown as { orientation?: { unlock?: () => void } }).orientation;
      try { o?.unlock?.(); } catch { /* not supported */ }
    }
  };

  const turnedNow = turned && portrait;

  const btn: React.CSSProperties = { background: "rgba(255,255,255,.14)", color: "#fff", border: 0, borderRadius: 8, padding: "8px 12px", fontSize: "1rem", fontWeight: 700, cursor: "pointer", minWidth: 44 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column" }}>
      {/* The close button belongs to the CHROME, and fades with it. It used to
          sit outside the element that went fullscreen, so it was either always
          on top of the class or gone entirely. */}
      <button
        type="button"
        onClick={onClose}
        style={{
          ...btn, position: "absolute", top: "calc(10px + env(safe-area-inset-top))", right: 12, zIndex: 6,
          opacity: chrome ? 1 : 0, pointerEvents: chrome ? "auto" : "none", transition: "opacity .25s ease",
        }}
      >✕ Close</button>

      <div
        ref={wrapRef}
        className="offline-stage"
        /* The turn is applied INLINE, not by a class.
           It was a class, and this element already carries an inline
           `position: relative` — an inline style beats a class rule, so the
           class's `position: absolute` never took, and the picture never
           turned. Anything the class would have fought over is set here
           instead, where there is nothing to fight. */
        style={
          turnedNow
            ? {
                position: "absolute", top: 0, left: 0,
                width: "100vh", height: "100vw",
                transformOrigin: "top left",
                transform: "rotate(90deg) translateY(-100%)",
                display: "flex", flexDirection: "column", background: "#000",
              }
            : { position: "relative", flex: 1, display: "flex", flexDirection: "column", background: "#000", minHeight: 0 }
        }
      >
        <div style={{ position: "relative", flex: 1, minHeight: 0 }} onClick={tapPicture}>
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
        {/* The bar FLOATS over the picture rather than sitting under it.
            As a flex sibling it took about ninety points of height away from
            the video — a fifth of the screen once the picture is turned — so
            the class never filled the space even when the turn worked. Every
            video player puts its controls on top of the picture; this one was
            putting the picture on top of nothing. */}
        <div onPointerDown={showChrome} style={{
          position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5,
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px calc(10px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, rgba(0,0,0,.92), rgba(0,0,0,.55) 70%, transparent)",
          flexWrap: "wrap",
          // Out of the way while watching, back on a tap — the same as the
          // streamed player, so the two feel like one app.
          // Retires whatever the player thinks its "fullscreen" state is —
          // this overlay is always the whole screen, so there is no other
          // state worth waiting for.
          opacity: chrome ? 1 : 0,
          pointerEvents: chrome ? "auto" : "none",
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
          <button type="button" onClick={toggleTurn} style={btn} title={turnedNow ? "Back to upright" : "Fill the screen"}>{turnedNow ? "⤡" : "⛶"}</button>
        </div>
      </div>
    </div>
  );
}
