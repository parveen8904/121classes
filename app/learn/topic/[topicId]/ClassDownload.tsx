"use client";

import { useEffect, useState } from "react";
import { resolveOfflineKey, cacheOfflineKey } from "../../downloads/licenseCache";
import Help from "@/app/components/Help";
import OfflinePlayer from "@/app/components/OfflinePlayer";
import { nativeFileSrc } from "@/lib/nativeFileSrc";

type PV = {
  id: string;
  storage_url: string;
  iv_b64: string | null;
  alg: string | null;
  byte_size: number | null;
  resolution: string | null;
};

// A size a student can act on. "1.43 GB" answers "will this fit, and what will
// it cost me in data" — which is the whole reason to offer a choice of quality.
function sizeLabel(bytes: number | null | undefined): string {
  const n = Number(bytes) || 0;
  if (!n) return "";
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`;
}

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

export default function ClassDownload({ variants, watermark }: { variants: PV[]; watermark: string }) {
  // Best quality first; it is the one offered by default and the one a student
  // on wifi should get without thinking about it.
  const [chosen, setChosen] = useState<PV>(variants[0]);
  const pv = chosen;
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

    const attach = (n: Native) => {
      setNative(n);
      n.onProgress(onProgress);
      n.isDownloaded(pv.id, pv.byte_size ?? undefined).then((d) => {
        setReady(d);
        if (d) setLabel("Downloaded ✓");
      }).catch(() => { /* treat as not downloaded */ });
    };

    const find = (): boolean => {
      // 1) Desktop app.
      if (w.native) { attach(w.native); return true; }

      // 2) iPhone/Android app — adapt the OfflineClasses plugin to the same shape.
      const cap = w.Capacitor;
      const plugin = cap?.Plugins?.OfflineClasses;
      if (cap?.isNativePlatform?.() && plugin) {
        attach({
          download: (id, url, size) => plugin.download({ id, url, expectedSize: size }).then((r) => r.path),
          isDownloaded: (id, size) => plugin.isDownloaded({ id, expectedSize: size }).then((r) => r.value),
          onProgress: (cb) => { plugin.addListener("downloadProgress", cb); },
          play: async (id, keyB64, ivB64, alg) => {
            const { path } = await plugin.decrypt({ id, keyB64, ivB64, alg });
            setPlayerSrc(nativeFileSrc(path, cap.convertFileSrc));
            return true;
          },
        });
        return true;
      }
      return false;
    };

    // Capacitor registers its plugins into the WebView asynchronously, so a
    // single check on mount can miss it and leave a student inside the app
    // being told to go and get the app. Keep looking briefly.
    if (find()) return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (find() && timer) { clearInterval(timer); timer = null; }
    }, 250);
    const giveUp = setTimeout(() => { if (timer) { clearInterval(timer); timer = null; } }, 10000);
    return () => { if (timer) clearInterval(timer); clearTimeout(giveUp); };
  }, [pv.id, pv.byte_size]);

  // In a normal browser, prompt to get the app.
  if (!native) {
    return (
      <a className="btn small secondary" href="/download" style={{ marginTop: 12 }}>
        📥 Download offline (get the app)
      </a>
    );
  }

  async function download(v: PV = pv) {
    setLabel("Downloading… 0%");
    try {
      await native!.download(v.id, v.storage_url, v.byte_size ?? undefined);
      cacheOfflineKey(v.id); // mirror the play key now, while online — enables airplane-mode playback
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
      {/* One button per quality that has actually been prepared, each carrying
          its own size. A student on mobile data can see that 360p is 374 MB
          against 1.4 GB and decide for themselves — the same choice the
          downloads page has always offered. With only one quality ready there
          is nothing to choose, so it stays a single button. */}
      {!ready && variants.map((v) => (
        <button
          key={v.id}
          className={`btn small ${v.id === pv.id ? "" : "secondary"}`}
          type="button"
          onClick={() => { setChosen(v); download(v); }}
          title={`${v.resolution ?? "720p"}${sizeLabel(v.byte_size) ? ` — ${sizeLabel(v.byte_size)}` : ""}`}
        >
          {v.id === pv.id && label !== "Download for offline"
            ? `📥 ${label}`
            : `📥 ${v.resolution ?? "720p"}${sizeLabel(v.byte_size) ? ` · ${sizeLabel(v.byte_size)}` : ""}`}
        </button>
      ))}
      {ready && <span className="muted" style={{ fontSize: ".82rem" }}>✅ Downloaded at {pv.resolution ?? "720p"}</span>}
      <Help text="Saves this class to your device so you can watch it without internet. It downloads securely (encrypted) and CONTINUES IN THE BACKGROUND — you can lock the phone or leave the app; check back in a few minutes. Pick a smaller size if you are on mobile data." />
      {ready && (
        <>
          <button className="btn small" type="button" onClick={play}>
            ▶️ Play offline
          </button>
          <Help text="Opens the downloaded class in the secure player. Your name stays watermarked on the video. No internet needed once it's downloaded." />
        </>
      )}

      {/* Secure offline player: custom controls, watermark survives fullscreen. */}
      {playerSrc && <OfflinePlayer src={playerSrc} watermark={watermark} onClose={() => setPlayerSrc(null)} />}
    </div>
  );
}
