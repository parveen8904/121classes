"use client";

import { useEffect, useRef, useState } from "react";

// White-label Zoom class: the meeting runs INSIDE this element, on our domain.
// We load Zoom's Meeting SDK (Component View) from its CDN at runtime and join
// with a server-issued signature — no zoom.us link is ever shown to students.
const SDK_VER = "3.11.2";

declare global { interface Window { ZoomMtgEmbedded?: { createClient: () => ZoomClient } } }
type ZoomClient = {
  init: (o: Record<string, unknown>) => Promise<void>;
  join: (o: Record<string, unknown>) => Promise<void>;
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error("load"));
    document.head.appendChild(s);
  });
}

export default function ZoomEmbed({ sessionId, title }: { sessionId: string; title: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "joining" | "in" | "error" | "unavailable">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/zoom/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setStatus(j.error === "unavailable" ? "unavailable" : "error");
          setMsg(j.error === "unconfigured" ? "The live class isn't set up yet." : j.error === "login" ? "Please log in." : "This class isn't available right now.");
          return;
        }
        const d = await res.json();
        await loadScript(`https://source.zoom.us/${SDK_VER}/zoom-meeting-embedded-${SDK_VER}.min.js`);
        if (cancelled || !window.ZoomMtgEmbedded || !rootRef.current) return;
        setStatus("joining");
        const client = window.ZoomMtgEmbedded.createClient();
        await client.init({ zoomAppRoot: rootRef.current, language: "en-US", patchJsMedia: true,
          customize: { video: { isResizable: true, viewSizes: { default: { width: rootRef.current.clientWidth, height: Math.round(rootRef.current.clientWidth * 0.6) } } } } });
        await client.join({
          sdkKey: d.sdkKey, signature: d.signature, meetingNumber: d.meetingNumber,
          password: d.passcode || "", userName: d.userName, userEmail: d.userEmail,
        });
        if (!cancelled) setStatus("in");
      } catch {
        if (!cancelled) { setStatus("error"); setMsg("Couldn't start the class. Please refresh, or try again in a moment."); }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <div>
      {status !== "in" && (
        <div className="card" style={{ marginBottom: 12 }}>
          {status === "loading" && <p className="muted" style={{ margin: 0 }}>⏳ Preparing your class…</p>}
          {status === "joining" && <p className="muted" style={{ margin: 0 }}>🎥 Connecting you to <strong>{title}</strong>…</p>}
          {status === "unavailable" && <p className="muted" style={{ margin: 0 }}>This class hasn&apos;t started yet, or isn&apos;t available. Please come back at the scheduled time.</p>}
          {status === "error" && <p className="muted" style={{ margin: 0 }}>{msg}</p>}
        </div>
      )}
      <div ref={rootRef} style={{ width: "100%", minHeight: 420 }} />
    </div>
  );
}
