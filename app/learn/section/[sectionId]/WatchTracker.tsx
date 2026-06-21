"use client";

import { useEffect, useRef } from "react";
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
  const maxPos = useRef(0);
  const realAccum = useRef(0);
  const playing = useRef(false);

  const finalSrc = provider === "youtube" ? withParam(src, "enablejsapi", "1") : src;

  useEffect(() => {
    logActivity("class_open", { sectionId, topicId });
    const timers: ReturnType<typeof setInterval>[] = [];

    const flush = (ended = false) => {
      const r = Math.round(realAccum.current);
      realAccum.current = 0;
      if (maxPos.current > 0 || ended) {
        recordWatch({ sectionId, videoSeconds: maxPos.current, deltaRealSeconds: r, durationSeconds, ended });
      }
    };

    timers.push(setInterval(() => { if (playing.current) realAccum.current += 1; }, 1000));
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
        const player = new window.playerjs.Player(iframeRef.current);
        player.on("ready", () => {
          player.on("timeupdate", (d: any) => { const s = Number(d?.seconds) || 0; if (s > maxPos.current) maxPos.current = s; });
          player.on("play", () => { playing.current = true; });
          player.on("pause", () => { playing.current = false; flush(false); });
          player.on("ended", () => { playing.current = false; flush(true); });
        });
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
      document.removeEventListener("visibilitychange", onHide);
      flush(false);
    };
  }, [sectionId, durationSeconds, topicId, provider]);

  return (
    <div className="video-frame" style={{ marginTop: 16 }}>
      <iframe ref={iframeRef} src={finalSrc} allow="encrypted-media; fullscreen" allowFullScreen title="Class video" />
      {watermark && <span className="vwm">{watermark}</span>}
    </div>
  );
}
