"use client";

import { useEffect } from "react";

// Marks the page as running inside the iPhone/Android app (html.in-app).
// CSS then hides purchase surfaces (.hide-in-app) and shows the app-only
// notes (.show-in-app) — Apple forbids selling digital content in-app
// outside their payment system, so plans are managed on the website only.
export default function InAppMode() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) document.documentElement.classList.add("in-app");

    // WHERE THE SYSTEM BARS ARE.
    //
    // From Android 16 an app cannot ask to be laid out inside the status bar
    // and the navigation bar — every app draws under them, and must hold its
    // own content clear. The native side could simply pad the whole WebView
    // down, but then the strip behind the clock would be whatever colour the
    // window happens to be, and this site has a dark theme and a light one.
    // The strip would be right in one and wrong in the other.
    //
    // So the page is given the measurements and paints the whole screen
    // itself. Its own background reaches the top edge in either theme, and the
    // header simply starts below the clock.
    (window as unknown as { __appInsets?: (t: number, r: number, b: number, l: number) => void })
      .__appInsets = (t, r, b, l) => {
        const s = document.documentElement.style;
        s.setProperty("--inset-top", `${t}px`);
        s.setProperty("--inset-right", `${r}px`);
        s.setProperty("--inset-bottom", `${b}px`);
        s.setProperty("--inset-left", `${l}px`);
      };
  }, []);
  return null;
}
