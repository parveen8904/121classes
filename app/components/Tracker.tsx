"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// First-party page-view beacon (our own DB — no third-party analytics, no
// cookies beyond a random anonymous browser key). Fires once per route change;
// sendBeacon survives navigation and never slows the page.
function visitorKey(): string {
  try {
    let k = localStorage.getItem("vkey");
    if (!k) {
      k = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem("vkey", k);
    }
    return k;
  } catch {
    return "";
  }
}

export function track(event: string, path?: string) {
  try {
    // Keep the ?src= tag (yt/wa/ig/tg…) so campaign-link clicks are measurable.
    const src = new URLSearchParams(location.search).get("src");
    const base = path ?? location.pathname;
    const withSrc = src && !base.includes("?") ? `${base}?src=${src.slice(0, 20)}` : base;
    const payload = JSON.stringify({ path: withSrc, event, visitor: visitorKey() });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    else fetch("/api/track", { method: "POST", body: payload, keepalive: true }).catch(() => {});
  } catch { /* never break the page */ }
}

export default function Tracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    track("view", pathname);
  }, [pathname]);
  return null;
}
