"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { recordWatch, logActivity } from "./watch-actions";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    playerjs?: any;
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function withParam(url: string, key: string, val: string): string {
  return url.includes(`${key}=`) ? url : url + (url.includes("?") ? "&" : "?") + `${key}=${val}`;
}

// Tracks how a student watches a class: furthest video position + real time spent.
// Bunny & most embeds → Player.js; YouTube → the YouTube IFrame API. Arbitrary
// embeds with no API still log that the class was opened.
export default function WatchTracker({
  src,
  provider,
  sectionId,
  durationSeconds,
  topicId,
  watermark,
}: {
  src: string;
  provider: "bunny" | "youtube" | "embed";
  sectionId: string;
  durationSeconds: number;
  topicId?: string;
  watermark?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // SEEKING BY TEN SECONDS, WHICH THE ARROW KEYS DID NOT DO.
  //
  // A student reported the arrow keys nudging the class forward a second or
  // two. They were never ours: when the iframe has focus the keystroke goes to
  // Bunny's own player, whose arrow step is a fraction of what anybody wants
  // when they have missed a sentence — and a cross-origin iframe swallows the
  // event, so nothing on this page could see it either.
  //
  // Both halves are fixed here. The player handle lets us seek properly, and
  // there are visible ⏪/⏩ buttons as well, because a button works whatever
  // has focus and a key does not.
  const playerRef = useRef<{ getCurrentTime?: (cb: (t: number) => void) => void; setCurrentTime?: (t: number) => void } | null>(null);
  const [seekMsg, setSeekMsg] = useState<string | null>(null);
  const maxPos = useRef(0);
  // The player's ACTUAL position, refreshed ~4×/second by timeupdate. Kept for
  // the seek buttons: asking the player for its time through the async callback
  // sometimes answered stale, so "current + 10" landed one or two seconds ahead
  // of where the video truly was — the exact glitch students reported.
  const livePos = useRef(0);
  const livePosAt = useRef(0);
  const realAccum = useRef(0);
  const playing = useRef(false);
  // When the last position arrived. Positions stop the moment a video is
  // paused, so silence is how a pause is noticed on a player that never says
  // so out loud.
  const lastTick = useRef(0);

  const finalSrc = provider === "youtube" ? withParam(src, "enablejsapi", "1") : src;

  useEffect(() => {
    logActivity("class_open", { sectionId, topicId });
    const timers: ReturnType<typeof setInterval>[] = [];
    const cleanups: (() => void)[] = [];

    const flush = (ended = false) => {
      const r = Math.round(realAccum.current);
      realAccum.current = 0;
      // Time spent counts even when the player never reported a position —
      // otherwise a class watched in a player we cannot read leaves no trace at
      // all. Half the watch records had no video position; they should at least
      // have carried the minutes.
      if (maxPos.current > 0 || r > 0 || ended) {
        recordWatch({ sectionId, videoSeconds: maxPos.current, deltaRealSeconds: r, durationSeconds, ended });
      }
    };

    timers.push(setInterval(() => {
      // Positions arrive several times a second while a video runs and stop
      // dead when it is paused. Two seconds of silence means paused, whether or
      // not the player bothered to say so.
      if (playing.current && lastTick.current && Date.now() - lastTick.current > 2500) {
        playing.current = false;
        flush(false);
      }
      if (playing.current) realAccum.current += 1;
    }, 1000));
    timers.push(setInterval(() => { if (realAccum.current >= 15) flush(false); }, 5000));
    const onHide = () => { if (document.hidden) { playing.current = false; flush(false); } };
    document.addEventListener("visibilitychange", onHide);

    if (provider === "youtube") {
      // ---- YouTube IFrame API ----
      const create = () => {
        if (!window.YT || !window.YT.Player || !iframeRef.current) return;
        const p = new window.YT.Player(iframeRef.current, {
          events: {
            onStateChange: (e: any) => {
              if (e.data === 1) playing.current = true;        // playing
              else if (e.data === 2) { playing.current = false; flush(false); } // paused
              else if (e.data === 0) { playing.current = false; flush(true); }  // ended
            },
          },
        });
        timers.push(setInterval(() => {
          try { const t = Number(p.getCurrentTime?.()) || 0; if (t > maxPos.current) maxPos.current = t; } catch { /* not ready */ }
        }, 2000));
      };
      if (window.YT && window.YT.Player) create();
      else {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { prev?.(); create(); };
        if (!document.getElementById("yt-iframe-api")) {
          const s = document.createElement("script");
          s.id = "yt-iframe-api";
          s.src = "https://www.youtube.com/iframe_api";
          document.body.appendChild(s);
        }
      }
    } else {
      // ---- Player.js (Bunny, Vimeo, Wistia & other embeds that support it) ----
      const setup = () => {
        if (!window.playerjs || !iframeRef.current) return;
        let readyFired = false;
        const player = new window.playerjs.Player(iframeRef.current);
        playerRef.current = player as never;
        player.on("ready", () => {
          readyFired = true;
          // The POSITION is what says somebody is watching — not the play
          // event. Measured on two live classes: one sent play, the other sent
          // ready and fifty-two timeupdates and no play at all. On that second
          // class nothing was ever counted as watched, so no time accrued, so
          // nothing was written for as long as it ran — and on a phone the
          // page is rarely closed cleanly, so the position went nowhere.
          //
          // A moving position is proof of watching, and it arrives about four
          // times a second whatever else the player does or does not announce.
          player.on("timeupdate", (d: any) => {
            const s = Number(d?.seconds) || 0;
            if (s > maxPos.current) maxPos.current = s;
            livePos.current = s;
            livePosAt.current = Date.now();
            playing.current = true;
            lastTick.current = Date.now();
          });
          player.on("play", () => { playing.current = true; lastTick.current = Date.now(); });
          player.on("pause", () => { playing.current = false; flush(false); });
          player.on("ended", () => { playing.current = false; flush(true); });
        });

        // Bunny sends NOTHING until playback starts. Measured on a live class:
        // no message of any origin on load, and then at the moment play is
        // pressed a burst of them —
        //   {"context":"player.js","event":"ready", ...}
        //   {"context":"player.js","event":"timeupdate","value":{"seconds":0.29}}
        // — pushed continuously without being asked. So "ready" is not a signal
        // that the frame has loaded; it is a signal that the student has begun
        // watching, and waiting for it before subscribing is correct.
        //
        // An earlier version reloaded the frame when ready had not arrived
        // within two seconds, on the theory that the announcement had been
        // missed. It never had been — it simply had not happened yet — so that
        // reloaded the player on every class page, every time, and would cut
        // off anyone who pressed play quickly. Removed.
      };
      if (window.playerjs) setup();
      else {
        const sc = document.createElement("script");
        sc.src = "https://cdn.embed.ly/player-0.1.0.min.js";
        sc.async = true;
        sc.onload = setup;
        document.body.appendChild(sc);
      }
    }

    return () => {
      timers.forEach(clearInterval);
      cleanups.forEach((fn) => fn());
      document.removeEventListener("visibilitychange", onHide);
      flush(false);
    };
  }, [sectionId, durationSeconds, topicId, provider]);

  // Ten seconds, the way every player a student has ever used behaves.
  const seekBy = useCallback((delta: number) => {
    const p = playerRef.current;
    if (!p?.setCurrentTime) return;
    const jump = (from: number) => {
      const to = Math.max(0, from + delta);
      try { p.setCurrentTime!(to); } catch { /* a player that will not seek must not break the page */ }
      // The seek itself moves the clock; keep our copy honest so a second press
      // within the same second stacks (+20) instead of re-adding to the old spot.
      livePos.current = to;
      livePosAt.current = Date.now();
      setSeekMsg(`${delta > 0 ? "⏩" : "⏪"} ${Math.abs(delta)}s`);
      window.setTimeout(() => setSeekMsg(null), 700);
    };
    // The timeupdate stream is the truth: it arrives ~4×/second while playing.
    // The async getCurrentTime callback is the fallback for a paused player,
    // where timeupdates have stopped and the last one may be stale.
    if (livePosAt.current && Date.now() - livePosAt.current < 1500) {
      jump(livePos.current);
    } else if (p.getCurrentTime) {
      try { p.getCurrentTime((t: number) => jump(Number(t) || livePos.current || 0)); }
      catch { jump(livePos.current || 0); }
    } else {
      jump(livePos.current || 0);
    }
  }, []);

  // Arrow keys, when the focus is anywhere on our page rather than inside the
  // iframe. Shift makes it a minute — useful for skipping a worked example.
  // Typing in a box is never a seek.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = (el?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let delta = 0;
      if (e.key === "ArrowRight" || e.key === "l" || e.key === "L") delta = e.shiftKey ? 60 : 10;
      if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") delta = e.shiftKey ? -60 : -10;
      if (!delta) return;
      e.preventDefault();
      seekBy(delta);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seekBy]);

  // Fullscreen OUR container (iframe + watermark), not the bare iframe — so the
  // moving watermark stays on top in fullscreen. (Bunny's own fullscreen button
  // is removed via the library Controls setting, which would strip the overlay.)
  const wrapRef = useRef<HTMLDivElement>(null);

  // Turning the phone sideways is how a student says "I want to watch this
  // properly". The player is then sized to the height of the screen, but the
  // page is still scrolled to wherever it was, so the header sat over the top
  // of it and the control bar hung off the bottom. Bring it to the top.
  useEffect(() => {
    const onRotate = () => {
      if (window.innerWidth <= window.innerHeight) return;
      setTimeout(() => wrapRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
    };
    window.addEventListener("orientationchange", onRotate);
    return () => window.removeEventListener("orientationchange", onRotate);
  }, []);

  // Fullscreen, the way a video player is expected to behave.
  //
  // Two things were wrong. Our own ⛶ button is pinned to the corner of the
  // player with nothing to hide it, so it sat over the video permanently —
  // "I can still see the controls in full screen". And we went fullscreen in
  // whatever way up the phone happened to be: a 16:9 class inside an upright
  // phone is a strip in the middle with a wide black band above and below it,
  // which is not full screen by any reasonable reading of the words.
  //
  // So: entering fullscreen turns the picture sideways, and the button fades
  // out on its own. One tap anywhere brings it back for a few seconds.
  const [isFull, setIsFull] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  // iOS refuses to turn the screen; we turn the picture instead.
  const [selfRotate, setSelfRotate] = useState(false);
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
      // Landscape is what makes it edge to edge. Android honours this while
      // fullscreen is active; iOS has no orientation lock and simply refuses,
      // which is why the promise is swallowed rather than awaited.
      const orientation = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
      if (!on) {
        try { orientation?.unlock?.(); } catch { /* nothing to unlock */ }
        setSelfRotate(false);
        setShowChrome(true);
        return;
      }
      bumpChrome();
      // iPhone and iPad have NO orientation lock — WebKit does not implement
      // it. Android does. So: ask, and if the answer is no (or there is nobody
      // to ask), rotate the player ourselves so an upright phone still gets a
      // picture that fills the screen instead of a strip between two black
      // bands. Only worth doing while the screen is actually upright.
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

  const goFullscreen = () => {
    const el = wrapRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  };

  return (
    <div
      className={`video-frame${isFull && selfRotate ? " fs-rotate" : ""}`}
      ref={wrapRef}
      style={{ marginTop: 16 }}
      onPointerDown={() => { if (isFull) bumpChrome(); }}
    >
      {/* No allowFullScreen, and no "fullscreen" in allow — on purpose.
          Bunny ships its own fullscreen button, and on a phone that is the one
          a student's thumb lands on. It fullscreens the IFRAME, which means: no
          watermark (the overlay lives outside it), a picture cropped to fit an
          upright screen with the sides of the whiteboard cut off mid-word, and
          none of the behaviour below — the controls never retire and the phone
          never turns. It also quietly undid the watermark this player exists to
          apply.
          Withdrawing the permission is what removes it: a player asks the
          browser whether fullscreen is available and hides the button when the
          answer is no. Our own ⛶ is unaffected — it fullscreens the container
          around the iframe, which belongs to this page, not to Bunny. */}
      <iframe ref={iframeRef} src={finalSrc} allow="encrypted-media" title="Class video" />
      {watermark && <span className="vwm">{watermark}</span>}
      {/* A BUTTON WORKS WHATEVER HAS FOCUS. Keys do not: once a student has
          clicked the video, the keystrokes belong to Bunny and this page never
          hears them. These are the reliable way back ten seconds. */}
      <div
        style={{
          position: "absolute", bottom: 8, left: 8, zIndex: 4, display: "flex", gap: 6,
          opacity: isFull && !showChrome ? 0 : 1,
          pointerEvents: isFull && !showChrome ? "none" : "auto",
          transition: "opacity .25s ease",
        }}
      >
        {[-10, 10].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => seekBy(d)}
            aria-label={d < 0 ? "Back 10 seconds" : "Forward 10 seconds"}
            title={d < 0 ? "Back 10s (← or J · hold Shift for a minute)" : "Forward 10s (→ or L · hold Shift for a minute)"}
            style={{
              background: "rgba(0,0,0,.55)", color: "#fff", border: 0, borderRadius: 8,
              padding: "6px 10px", fontSize: ".95rem", cursor: "pointer",
            }}
          >
            {d < 0 ? "⏪ 10" : "10 ⏩"}
          </button>
        ))}
      </div>

      {seekMsg && (
        <span
          style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 5, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 10,
            padding: "8px 14px", fontSize: "1.1rem", pointerEvents: "none",
          }}
        >
          {seekMsg}
        </span>
      )}

      <button
        type="button"
        onClick={goFullscreen}
        aria-label={isFull ? "Leave fullscreen" : "Fullscreen"}
        title={isFull ? "Leave fullscreen" : "Fullscreen"}
        style={{
          position: "absolute", bottom: 8, right: 8, zIndex: 4,
          background: "rgba(0,0,0,.55)", color: "#fff", border: 0, borderRadius: 8,
          padding: "6px 10px", fontSize: "1rem", cursor: "pointer",
          // Out of the way while watching; one tap on the video brings it back.
          opacity: isFull && !showChrome ? 0 : 1,
          pointerEvents: isFull && !showChrome ? "none" : "auto",
          transition: "opacity .25s ease",
        }}
      >
        {isFull ? "✕" : "⛶"}
      </button>
    </div>
  );
}
