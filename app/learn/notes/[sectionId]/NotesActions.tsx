"use client";

import { useState } from "react";

type CapGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: { OfflineClasses?: { shareFile?: (o: { name: string; mimeType: string; dataB64: string }) => Promise<void> } };
};

// Save/share the stamped PDF WITHOUT navigating the page. Priority:
// 1) iPhone/Android app → our native share sheet (the in-app browser has NO
//    Web Share API, so this is the only path that works there),
// 2) mobile Safari → Web Share (share sheet),
// 3) desktop → classic file download.
// The server stamps the student's identity on every page (dl=1).
export default function NotesActions({ fileUrl, title }: { fileUrl: string; title: string }) {
  const [busy, setBusy] = useState<"share" | "download" | null>(null);

  async function saveShare(mode: "share" | "download") {
    setBusy(mode);
    try {
      const res = await fetch(`${fileUrl}&dl=1`);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const name = `${(title || "notes").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "notes"}.pdf`;

      const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
      const share = cap?.Plugins?.OfflineClasses?.shareFile;
      if (cap?.isNativePlatform?.() && share) {
        // Native app: the OS share sheet is the only save path (its "Save to
        // Files" option is the download) — used for BOTH buttons.
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
        await share({ name, mimeType: "application/pdf", dataB64: btoa(bin) });
        return;
      }

      // Browser + "share" → the share sheet when available.
      if (mode === "share") {
        const file = new File([blob], name, { type: "application/pdf" });
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
        if (nav.share && nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], title: name });
          return;
        }
      }
      // "download" (or share unsupported) → direct file download to the device.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      // Surface real failures (the old version failed silently in the app).
      const msg = e instanceof Error ? e.message : "";
      if (msg && msg !== "Share canceled" && !msg.toLowerCase().includes("abort")) {
        alert("Could not prepare the notes — please check your internet and try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button className="btn small" type="button" disabled={busy !== null} onClick={() => saveShare("download")}>
        {busy === "download" ? "⏳ Preparing…" : "⬇️ Download"}
      </button>
      <button className="btn small secondary" type="button" disabled={busy !== null} onClick={() => saveShare("share")}>
        {busy === "share" ? "⏳ Preparing…" : "📤 Share / Print"}
      </button>
    </span>
  );
}
