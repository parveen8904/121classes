"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Play-Store rating prompt — engineered for GOOD reviews by asking the right
// person at the right time:
//   • only inside the app — Android OR iPhone, each sent to its own store
//   • only after the student has used the app on 3+ different days (invested)
//   • only on engaged pages (dashboard / learning area), never mid-payment
//   • at most once per 45 days; never again once rated; twice dismissed = stop
//   • "something's wrong" goes to /support (tickets), not to the store
const PLAY_URL = "https://play.google.com/store/apps/details?id=in.caclasses.app";
// The App Store's own "write a review" deep link. `id` is filled from the
// numeric Apple ID kept in the environment, because it is only issued once the
// app is on sale and hard-coding a wrong one sends people to somebody else's
// listing. With no id set, iPhone users are simply never asked — which is the
// right failure: a prompt that leads nowhere is worse than no prompt.
const APPLE_ID = process.env.NEXT_PUBLIC_APPLE_APP_ID || "";
const APP_STORE_URL = APPLE_ID
  ? `https://apps.apple.com/app/id${APPLE_ID}?action=write-review`
  : "";
const SHOW_ON = ["/dashboard", "/learn"];
const K_DAYS = "rate.days";        // list of distinct use-days (in-app)
const K_LAST = "rate.lastAsk";     // timestamp of last prompt
const K_DONE = "rate.done";        // rated or dismissed twice
const K_DISMISS = "rate.dismissCount";

export default function RatePrompt() {
  const pathname = usePathname() || "/";
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!SHOW_ON.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
      if (!document.documentElement.classList.contains("in-app")) return;
      // BOTH STORES NOW. iOS was held back until the app was approved, which it
      // has been — so an iPhone student who has used the app on three separate
      // days is asked too, and sent to the App Store's own review sheet.
      const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
      const platform = cap?.getPlatform?.();
      if (platform !== "android" && platform !== "ios") return;
      // An iPhone with no Apple ID configured is never asked, rather than being
      // shown a button that goes nowhere.
      if (platform === "ios" && !APP_STORE_URL) return;

      if (localStorage.getItem(K_DONE)) return;

      // Count distinct days of in-app use.
      const today = new Date().toISOString().slice(0, 10);
      const days: string[] = JSON.parse(localStorage.getItem(K_DAYS) || "[]");
      if (!days.includes(today)) {
        days.push(today);
        localStorage.setItem(K_DAYS, JSON.stringify(days.slice(-30)));
      }
      if (days.length < 3) return;

      const last = Number(localStorage.getItem(K_LAST) || 0);
      if (last && Date.now() - last < 45 * 86400e3) return;

      // Small delay — let them start doing what they came for first.
      const t = setTimeout(() => {
        localStorage.setItem(K_LAST, String(Date.now()));
        setShow(true);
      }, 20000);
      return () => clearTimeout(t);
    } catch { /* storage unavailable — never break the page */ }
  }, [pathname]);

  if (!show) return null;

  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const isIos = cap?.getPlatform?.() === "ios";
  const storeUrl = isIos ? APP_STORE_URL : PLAY_URL;
  const storeLabel = isIos ? "⭐ Rate on the App Store" : "⭐ Rate on Google Play";

  function close(done = false) {
    try {
      if (done) localStorage.setItem(K_DONE, "1");
      else {
        const n = Number(localStorage.getItem(K_DISMISS) || 0) + 1;
        localStorage.setItem(K_DISMISS, String(n));
        if (n >= 2) localStorage.setItem(K_DONE, "1");
      }
    } catch { /* ignore */ }
    setShow(false);
  }

  return (
    <div style={{ position: "fixed", left: 12, right: 12, bottom: 14, zIndex: 8600, display: "flex", justifyContent: "center" }}>
      <div className="card" style={{ maxWidth: 430, width: "100%", boxShadow: "0 6px 24px rgba(0,0,0,.35)" }}>
        <strong>Is the app helping your preparation? 🙏</strong>
        <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
          A 30-second rating helps other CA students find it.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn small" href={storeUrl} target="_blank" rel="noopener noreferrer" onClick={() => close(true)}>
            {storeLabel}
          </a>
          <a className="btn small secondary" href="/support" onClick={() => close(true)}>
            🛠 Something&apos;s wrong
          </a>
          <button className="btn small secondary" onClick={() => close(false)} style={{ marginLeft: "auto" }}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
