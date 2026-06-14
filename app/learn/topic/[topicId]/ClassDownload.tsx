"use client";

import { useEffect, useState } from "react";
import { getOfflineKey } from "../../downloads/actions";
import Help from "@/app/components/Help";

type PV = {
  id: string;
  storage_url: string;
  iv_b64: string | null;
  alg: string | null;
  byte_size: number | null;
};

type Native = {
  download: (id: string, url: string, expectedSize?: number) => Promise<string>;
  isDownloaded: (id: string, expectedSize?: number) => Promise<boolean>;
  play: (id: string, keyB64: string, ivB64: string | null, alg: string | null, watermark: string) => Promise<boolean>;
  onProgress: (cb: (d: { id: string; received: number; total: number }) => void) => void;
};

export default function ClassDownload({ pv, watermark }: { pv: PV; watermark: string }) {
  const [native, setNative] = useState<Native | null>(null);
  const [label, setLabel] = useState("Download for offline");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const n = (window as unknown as { native?: Native }).native;
    if (!n) return;
    setNative(n);
    n.onProgress(({ id, received, total }) => {
      if (id !== pv.id) return;
      const pct = total ? Math.floor((received * 100) / total) : 0;
      setLabel(pct >= 100 ? "Downloaded ✓" : `Downloading… ${pct}%`);
    });
    n.isDownloaded(pv.id, pv.byte_size ?? undefined).then((d) => {
      setReady(d);
      if (d) setLabel("Downloaded ✓");
    });
  }, [pv.id, pv.byte_size]);

  // In a normal browser, prompt to get the desktop app.
  if (!native) {
    return (
      <a className="btn small secondary" href="/help" style={{ marginTop: 12 }}>
        📥 Download offline (get the app)
      </a>
    );
  }

  async function download() {
    setLabel("Downloading… 0%");
    try {
      await native!.download(pv.id, pv.storage_url, pv.byte_size ?? undefined);
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
      const lic = await getOfflineKey(pv.id);
      if (!lic) {
        alert("Access check failed — please contact us.");
        setLabel("Downloaded ✓");
        return;
      }
      setLabel("Decrypting… ⏳");
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
      <Help text="Saves this class to your computer so you can watch it without internet. It downloads securely (encrypted) — the first time can take a few minutes for a long class." />
      {ready && (
        <>
          <button className="btn small" type="button" onClick={play}>
            ▶️ Play offline
          </button>
          <Help text="Opens the downloaded class in the secure player. Your name stays watermarked on the video. No internet needed once it's downloaded." />
        </>
      )}
    </div>
  );
}
