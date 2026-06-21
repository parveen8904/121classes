"use client";

import { useEffect, useRef } from "react";
import { recordWatch, logActivity } from "./watch-actions";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { playerjs?: any }
}

// Wraps the class video iframe and tracks watching via the Bunny/Player.js events:
// the furthest video position reached + real time spent. Sends periodic chunks to
// the server so we can see how each student actually watches (pace, gaps, finished).
export default function WatchTracker({
  src,
  sectionId,
  durationSeconds,
  topicId,
  watermark,
}: {
  src: string;
  sectionId: string;
  durationSeconds: number;
  topicId?: string;
  watermark?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const maxPos = useRef(0);
  const realAccum = useRef(0); // real seconds since last flush
  const playing = useRef(false);

  useEffect(() => {
    logActivity("class_open", { sectionId, topicId });
    let tick: ReturnType<typeof setInterval> | null = null;
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const flush = (ended = false) => {
      const r = Math.round(realAccum.current);
      realAccum.current = 0;
      if (maxPos.current > 0 || ended) {
        recordWatch({ sectionId, videoSeconds: maxPos.current, deltaRealSeconds: r, durationSeconds, ended });
      }
    };

    const setup = () => {
      if (!window.playerjs || !iframeRef.current) return;
      const player = new window.playerjs.Player(iframeRef.current);
      player.on("ready", () => {
        player.on("timeupdate", (d: any) => {
          const s = Number(d?.seconds) || 0;
          if (s > maxPos.current) maxPos.current = s;
        });
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

    tick = setInterval(() => { if (playing.current) realAccum.current += 1; }, 1000);
    flushTimer = setInterval(() => { if (realAccum.current >= 15) flush(false); }, 5000);
    const onHide = () => { if (document.hidden) { playing.current = false; flush(false); } };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      if (tick) clearInterval(tick);
      if (flushTimer) clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", onHide);
      flush(false);
    };
  }, [sectionId, durationSeconds, topicId]);

  return (
    <div className="video-frame" style={{ marginTop: 16 }}>
      <iframe ref={iframeRef} src={src} allow="encrypted-media; fullscreen" allowFullScreen title="Class video" />
      {watermark && <span className="vwm">{watermark}</span>}
    </div>
  );
}
