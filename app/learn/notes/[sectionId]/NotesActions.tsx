"use client";

import { useState } from "react";

// Save/share the stamped PDF WITHOUT navigating the page (navigating to the raw
// file traps app users on a chrome-less PDF view). Phones get the native share
// sheet (Save to Files / WhatsApp / Email / Print); desktops get a classic
// file download. The server stamps the student's identity on every page (dl=1).
export default function NotesActions({ fileUrl, title }: { fileUrl: string; title: string }) {
  const [busy, setBusy] = useState(false);

  async function saveShare() {
    setBusy(true);
    try {
      const res = await fetch(`${fileUrl}&dl=1`);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const name = `${(title || "notes").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "notes"}.pdf`;
      const file = new File([blob], name, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: name });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      /* share sheet dismissed or transient network error — nothing to clean up */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn small" type="button" disabled={busy} onClick={saveShare}>
      {busy ? "⏳ Preparing…" : "📤 Save / Share / Print"}
    </button>
  );
}
