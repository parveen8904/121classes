"use client";

import { useEffect, useState } from "react";
import { getOfflineKey } from "./actions";

type Klass = {
  id: string;
  title: string;
  subject_title: string | null;
  storage_url: string;
  iv_b64: string | null;
  alg: string | null;
  byte_size: number | null;
};

// Native bridge exposed by the desktop app's preload (undefined in a browser).
type Native = {
  download: (id: string, url: string, expectedSize?: number) => Promise<string>;
  isDownloaded: (id: string, expectedSize?: number) => Promise<boolean>;
  play: (id: string, keyB64: string, ivB64: string | null, alg: string | null, watermark: string) => Promise<boolean>;
  onProgress: (cb: (d: { id: string; received: number; total: number }) => void) => void;
};

export default function OfflineDownloads({
  classes,
  watermark,
}: {
  classes: Klass[];
  watermark: string;
}) {
  const [native, setNative] = useState<Native | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const n = (window as unknown as { native?: Native }).native;
    if (!n) return;
    setNative(n);
    n.onProgress(({ id, received, total }) => {
      const pct = total ? Math.floor((received * 100) / total) : 0;
      setLabels((l) => ({ ...l, [id]: pct >= 100 ? "Downloaded ✓" : `Downloading… ${pct}%` }));
    });
    (async () => {
      const r: Record<string, boolean> = {};
      for (const c of classes) r[c.id] = await n.isDownloaded(c.id, c.byte_size ?? undefined);
      setReady(r);
    })();
  }, [classes]);

  async function download(c: Klass) {
    if (!native) return;
    setLabels((l) => ({ ...l, [c.id]: "Downloading… 0%" }));
    try {
      await native.download(c.id, c.storage_url, c.byte_size ?? undefined);
      setLabels((l) => ({ ...l, [c.id]: "Downloaded ✓" }));
      setReady((r) => ({ ...r, [c.id]: true }));
    } catch (e) {
      setLabels((l) => ({ ...l, [c.id]: "Retry download" }));
      alert("Download failed: " + (e as Error).message);
    }
  }

  async function play(c: Klass) {
    if (!native) return;
    setLabels((l) => ({ ...l, [c.id]: "Verifying…" }));
    try {
      const lic = await getOfflineKey(c.id);
      if (!lic) {
        alert("This class isn't on your plan, or your access expired.");
        setLabels((l) => ({ ...l, [c.id]: "Downloaded ✓" }));
        return;
      }
      setLabels((l) => ({ ...l, [c.id]: "Decrypting… ⏳ (~1 min)" }));
      await native.play(c.id, lic.key, c.iv_b64, c.alg, watermark);
      setLabels((l) => ({ ...l, [c.id]: "Downloaded ✓" }));
    } catch (e) {
      alert("Cannot play: " + (e as Error).message);
      setLabels((l) => ({ ...l, [c.id]: "Downloaded ✓" }));
    }
  }

  if (!native) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.2rem" }}>🖥️</div>
        <h3 style={{ margin: "8px 0" }}>Download classes to watch offline</h3>
        <p className="muted">
          Offline downloads are available in the <strong>Mac / Windows desktop app</strong>. Open this same page
          inside the app to download your classes and play them without internet.
        </p>
        <a className="btn" href="/help" style={{ marginTop: 12 }}>
          Get the desktop app →
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="sec-list" style={{ marginTop: 8 }}>
        {classes.length === 0 ? (
          <div className="card">
            <p className="muted">No downloadable classes on your plan yet.</p>
          </div>
        ) : (
          classes.map((c) => (
            <div className="list-row" key={c.id}>
              <div>
                <span className="row-title">🔐 {c.title}</span>
                <p className="row-sub">
                  {c.subject_title ?? ""}
                  {c.byte_size ? ` · ${(Number(c.byte_size) / 1e6).toFixed(0)} MB` : ""}
                </p>
              </div>
              <div className="row-actions">
                <button className="btn small secondary" type="button" onClick={() => download(c)}>
                  {labels[c.id] ?? (ready[c.id] ? "Downloaded ✓" : "Download")}
                </button>
                <button className="btn small" type="button" disabled={!ready[c.id]} onClick={() => play(c)}>
                  Play
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
