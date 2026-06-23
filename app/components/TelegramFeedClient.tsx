"use client";

import { useEffect, useRef, useState } from "react";

// Loads recent channel post ids from /api/telegram-feed (async, non-blocking) and
// renders Telegram's official post embeds (auto-resizing iframes) in a scroll box.
export default function TelegramFeedClient({ username, link, height = 540 }: { username: string; link: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/telegram-feed?u=${encodeURIComponent(username)}`, { cache: "no-store" });
        const { ids } = (await res.json()) as { ids: number[] };
        if (cancelled) return;
        if (!ids?.length) { setState("empty"); return; }
        const el = ref.current;
        if (!el) return;
        el.innerHTML = "";
        for (const id of ids) {
          const s = document.createElement("script");
          s.async = true;
          s.src = "https://telegram.org/js/telegram-widget.js?22";
          s.setAttribute("data-telegram-post", `${username}/${id}`);
          s.setAttribute("data-width", "100%");
          s.setAttribute("data-dark", "1");
          el.appendChild(s);
        }
        setState("ready");
      } catch {
        if (!cancelled) setState("empty");
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  if (state === "empty") {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p className="muted" style={{ fontSize: ".85rem", margin: "0 0 8px" }}>Couldn&apos;t load channel posts right now.</p>
        <a className="btn small" href={link} target="_blank" rel="noreferrer" style={{ background: "#229ED9", color: "#fff" }}>✈️ Open the channel</a>
      </div>
    );
  }

  return (
    <div style={{ maxHeight: height, overflowY: "auto", padding: 8, border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-soft)" }}>
      {state === "loading" && <p className="muted" style={{ textAlign: "center", fontSize: ".85rem" }}>Loading latest posts…</p>}
      <div ref={ref} style={{ display: "grid", gap: 8 }} />
    </div>
  );
}
