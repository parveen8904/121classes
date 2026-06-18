"use client";

import { useEffect, useState } from "react";

// Dynamic pop-up banner. The image + duration + link are set in
// Admin → Site images → "Pop-up banner". Shows once per visit and auto-closes
// after the configured number of seconds.
export default function AnnouncementSplash({
  banner,
  link,
  seconds = 5,
}: {
  banner?: string;
  link?: string;
  seconds?: number;
}) {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!banner) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem("splashSeen") === "1";
    } catch {}
    if (seen) return;
    try {
      sessionStorage.setItem("splashSeen", "1");
    } catch {}

    const ms = Math.max(2, Math.min(20, seconds)) * 1000;
    setShow(true);
    const t1 = setTimeout(() => setLeaving(true), ms - 400);
    const t2 = setTimeout(() => setShow(false), ms);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [banner, seconds]);

  if (!banner || !show) return null;

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={banner} alt="Announcement" style={{ display: "block", width: "100%", height: "auto" }} />
  );

  return (
    <div
      className={`splash-overlay ${leaving ? "leaving" : ""}`}
      onClick={() => setShow(false)}
      role="dialog"
      aria-label="Announcement"
    >
      <div className="splash-card" onClick={(e) => e.stopPropagation()}>
        <button className="splash-close" onClick={() => setShow(false)} aria-label="Close">
          ×
        </button>
        {link ? (
          <a href={link} onClick={() => setShow(false)}>
            {img}
          </a>
        ) : (
          img
        )}
      </div>
    </div>
  );
}
