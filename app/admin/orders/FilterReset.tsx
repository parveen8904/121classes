"use client";

import { useEffect } from "react";

// A REFRESH SHOULD PUT THE PAGE BACK TO EVERYTHING.
//
// The filter lives in the address, which is right — it survives being shared,
// bookmarked and opened in a second tab, and the download can be built to match
// it. But it also means that hours later, on a reloaded tab, the register shows
// six orders and looks like a business that has stopped, with the reason a
// small tick box further up the page.
//
// So a genuine reload — not a click, not the back button — drops the status
// filter and shows everything again. Anyone who wanted to keep it need only
// tick it once more, and the "Show all" button does the same thing by hand.
export default function FilterReset() {
  useEffect(() => {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (nav?.type !== "reload") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("status")) return;
    url.searchParams.delete("status");
    // replace, not assign: the filtered address should not become a step in
    // the back button's history that a person keeps landing on.
    window.location.replace(url.toString());
  }, []);

  return null;
}
