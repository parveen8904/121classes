"use client";

import { useEffect, useState } from "react";
import { resolveOfflineKey, cacheOfflineKey } from "../../downloads/licenseCache";
import Help from "@/app/components/Help";

type PV = {
  id: string;
  storage_url: string;
  iv_b64: string | null;
  alg: string | null;
  byte_size: number | null;
};

// Desktop app (Electron) bridge — injected by its preload script.
type Native = {
  download: (id: string, url: string, expectedSize?: number) => Promise<string>;
  isDownloaded: (id: string, expectedSize?: number) => Promise<boolean>;
  play: (id: string, keyB64: string, ivB64: string | null, alg: string | null, watermark: string) => Promise<boolean>;
  onProgress: (cb: (d: { id: string; received: number; total: number }) => void) => void;
};

// Mobile app (Capacitor) plugin shape — via the injected window.Capacitor.
type CapPlugin = {
  download: (o: { id: string; url: string; expectedSize?: number }) => Promise<{ path: string }>;
  isDownloaded: (o: { id: string; expectedSize?: number }) => Promise<{ value: boolean }>;
  decrypt: (o: { id: string; keyB64: string; ivB64?: string | null; alg?: string | null }) => Promise<{ path: string }>;
  addListener: (eventName: string, cb: (d: { id: string; received: number; total: number }) => void) => unknown;
};
type CapGlobal = {
  isNativePlatform?: () => boolean;
  convertFileSrc?: (path: string) => string;
  Plugins?: { OfflineClasses?: CapPlugin };
};

export default function ClassDownload({ pv, watermark }: { pv: PV; watermark: string }) {
  const [native, setNative] = useState<Native | null>(null);
  const [label, setLabel] = useState("Download for offline");
  const [ready, setReady] = useState(false);
  const [playerSrc, setPlayerSrc] = useState<string | null>(null); // mobile inline player

  useEffect(() => {
    const w = window as unknown as { native?: Native; Capacitor?: CapGlobal };

    const onProgress = ({ id, received, total }: { id: string; received: number; total: number }) => {
      if (id !== pv.id) return;
      const pct = total ? Math.floor((received * 100) / total) : 0;
      setLabel(pct >= 100 ? "Downloaded ✓" : `Downloading… ${pct}%`);
    };

    // 1) Desktop app.
    if (w.native) {
      const n = w.native;
      setNative(n);
      n.onProgress(onProgress);
      n.isDownloaded(pv.id, pv.byte_size ?? undefined).then((d) => {
        setReady(d);
        if (d) setLabel("Downloaded ✓");
      });
      return;
    }

    // 2) iPhone/Android app — adapt the OfflineClasses plugin to the same shape.
    const cap = w.Capacitor;
    const plugin = cap?.Plugins?.OfflineClasses;
    if (cap?.isNativePlatform?.() && plugin) {
      const adapter: Native = {
        download: (id, url, size) => plugin.download({ id, url, expectedSize: size }).then((r) => r.path),
        isDownloaded: (id, size) => plugin.isDownloaded({ id, expectedSize: size }).then((r) => r.value),
        onProgress: (cb) => { plugin.addListener("downloadProgress", cb); },
        play: async (id, keyB64, ivB64, alg) => {
          const { path } = await plugin.decrypt({ id, keyB64, ivB64, alg });
          setPlayerSrc(cap.convertFileSrc ? cap.convertFileSrc(path) : path);
          return true;
        },
      };
      setNative(adapter);
      adapter.onProgress(onProgress);
      adapter.isDownloaded(pv.id, pv.byte_size ?? undefined).then((d) => {
        setReady(d);
        if (d) setLabel("Downloaded ✓");
      });
    }
  }, [pv.id, pv.byte_size]);

  // In a normal browser, prompt to get the app.
  if (!native) {
    return (
      <a className="btn small secondary" href="/download" style={{ marginTop: 12 }}>
        📥 Download offline (get the app)
      </a>
    );
  }

  async function download() {
    setLabel("Downloading… 0%");
    try {
      await native!.download(pv.id, pv.storage_url, pv.byte_size ?? undefined);
      cacheOfflineKey(pv.id); // mirror the play key now, while online — enables airplane-mode playback
      setLabel("Downloaded ✓");
      setReady(true);
    } catch (e) {
      setLabel("Retry download");
      alert("Download failed: " + (e as Error).message);
    }
  }

  async function play() {
    setLabel("Verifying…");
    try {
      const lic = await resolveOfflineKey(pv.id);
      if (!lic) {
        alert("Access check failed — please contact us.");
        setLabel("Downloaded ✓");
        return;
      }
      setLabel("Preparing… ⏳ (first play only)");
      await native!.play(pv.id, lic.key, pv.iv_b64, pv.alg, watermark);
      setLabel("Downloaded ✓");
    } catch (e) {
      alert("Cannot play: " + (e as Error).message);
      setLabel("Downloaded ✓");
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn small secondary" type="button" onClick={download}>
        📥 {label}
      </button>
      <Help text="Saves this class to your device so you can watch it without internet. It downloads securely (encrypted) and CONTINUES IN THE BACKGROUND — you can lock the phone or leave the app; check back in a few minutes." />
      {ready && (
        <>
          <button className="btn small" type="button" onClick={play}>
            ▶️ Play offline
          </button>
          <Help text="Opens the downloaded class in the secure player. Your name stays watermarked on the video. No internet needed once it's downloaded." />
        </>
      )}

      {/* Mobile inline secure player (decrypted temp file via the native plugin). */}
      {playerSrc && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column" }}>
          <button
            type="button"
            onClick={() => setPlayerSrc(null)}
            style={{ position: "absolute", top: "calc(12px + env(safe-area-inset-top))", right: 12, zIndex: 2, background: "rgba(0,0,0,.6)", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: 8, padding: "6px 12px", fontWeight: 700 }}
          >
            ✕ Close
          </button>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={playerSrc} controls autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
          {watermark && (
            <span style={{ position: "absolute", bottom: 16, left: 16, color: "rgba(255,255,255,.55)", fontSize: ".8rem", pointerEvents: "none", textShadow: "0 1px 2px #000" }}>
              {watermark}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
