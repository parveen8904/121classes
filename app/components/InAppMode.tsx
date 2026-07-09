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
  }, []);
  return null;
}
