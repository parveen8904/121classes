"use client";

import { useEffect, useState } from "react";
import { resolveOfflineKey, cacheOfflineKey } from "./licenseCache";

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
  remove?: (id: string) => Promise<void>;
};

// Capacitor (mobile app) plugin shape — accessed via the injected window.Capacitor.
type CapPlugin = {
  download: (o: { id: string; url: string; expectedSize?: number }) => Promise<{ path: string }>;
  isDownloaded: (o: { id: string; expectedSize?: number }) => Promise<{ value: boolean }>;
  decrypt: (o: { id: string; keyB64: string; ivB64?: string | null; alg?: string | null }) => Promise<{ path: string }>;
  remove: (o: { id: string }) => Promise<void>;
  addListener: (eventName: string, cb: (d: { id: string; received: number; total: number }) => void) => unknown;
};
type CapGlobal = {
  isNativePlatform?: () => boolean;
  convertFileSrc?: (path: string) => string;
  Plugins?: { OfflineClasses?: CapPlugin };
};

export default function OfflineDownloads({
  classes,
  watermark,
  isAdmin,
}: {
  classes: Klass[];
  watermark: string;
  isAdmin?: boolean;
}) {
  const [native, setNative] = useState<Native | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
  // Mobile plays inline in this overlay (desktop opens its own player window).
  const [playerSrc, setPlayerSrc] = useState<string | null>(null);

  useEffect(() => {
    const w = window as unknown as { native?: Native; Capacitor?: CapGlobal };

    // 1) Desktop app (Electron) — existing bridge.
    const electron = w.native;
    if (electron) {
      setNative(electron);
      electron.onProgress(({ id, received, total }) => {
        const pct = total ? Math.floor((received * 100) / total) : 0;
        setLabels((l) => ({ ...l, [id]: pct >= 100 ? "Downloaded ✓" : `Downloading… ${pct}%` }));
      });
      (async () => {
        const r: Record<string, boolean> = {};
        for (const c of classes) r[c.id] = await electron.isDownloaded(c.id, c.byte_size ?? undefined);
        setReady(r);
      })();
      return;
    }

    // 2) Mobile app (Capacitor) — adapt the OfflineClasses plugin to the same shape.
    const cap = w.Capacitor;
    const plugin = cap?.Plugins?.OfflineClasses;
    if (cap?.isNativePlatform?.() && plugin) {
      const adapter: Native = {
        download: (id, url, size) => plugin.download({ id, url, expectedSize: size }).then((r) => r.path),
        isDownloaded: (id, size) => plugin.isDownloaded({ id, expectedSize: size }).then((r) => r.value),
        onProgress: (cb) => { plugin.addListener("downloadProgress", cb); },
        remove: (id) => plugin.remove({ id }),
        play: async (id, keyB64, ivB64, alg, _wm) => {
          const { path } = await plugin.decrypt({ id, keyB64, ivB64, alg });
          const src = cap.convertFileSrc ? cap.convertFileSrc(path) : path;
          setPlayerSrc(src);
          return true;
        },
      };
      setNative(adapter);
      adapter.onProgress(({ id, received, total }) => {
        const pct = total ? Math.floor((received * 100) / total) : 0;
        setLabels((l) => ({ ...l, [id]: pct >= 100 ? "Downloaded ✓" : `Downloading… ${pct}%` }));
      });
      (async () => {
        const r: Record<string, boolean> = {};
        for (const c of classes) r[c.id] = await adapter.isDownloaded(c.id, c.byte_size ?? undefined);
        setReady(r);
      })();
    }
  }, [classes]);

  async function download(c: Klass) {
    if (!native) return;
    setLabels((l) => ({ ...l, [c.id]: "Downloading… 0%" }));
    try {
      await native.download(c.id, c.storage_url, c.byte_size ?? undefined);
      cacheOfflineKey(c.id); // mirror the play key now, while online — enables airplane-mode playback
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
      const lic = await resolveOfflineKey(c.id);
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

  async function removeDownload(c: Klass) {
    if (!native?.remove) return;
    if (!confirm(`Remove the downloaded copy of "${c.title}" from this device? You can download it again anytime.`)) return;
    try {
      await native.remove(c.id);
      try { localStorage.removeItem(`offkey:${c.id}`); } catch { /* no-op */ }
      setReady((r) => ({ ...r, [c.id]: false }));
      setLabels((l) => ({ ...l, [c.id]: "Download" }));
    } catch (e) {
      alert("Could not remove: " + (e as Error).message);
    }
  }

  if (!native) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.2rem" }}>📥</div>
        <h3 style={{ margin: "8px 0" }}>Download classes to watch offline</h3>
        <p className="muted">
          Offline downloads work inside the <strong>app</strong> — the <strong>Mac / Windows desktop app</strong> or the
          <strong> iPhone / Android app</strong>. Open this same page inside the app to download your classes and play them without internet.
        </p>
        <a className="btn" href="/download" style={{ marginTop: 12 }}>
          Get the app →
        </a>
      </div>
    );
  }

  // Folder view: one section per subject (students only ever receive the
  // subjects on their plan — admins receive everything, hence the note).
  const bySubject = new Map<string, Klass[]>();
  for (const c of classes) {
    const k = c.subject_title ?? "Other";
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k)!.push(c);
  }

  return (
    <>
      {isAdmin && (
        <div className="notice ok" style={{ fontSize: ".82rem", marginBottom: 14 }}>
          👑 <strong>Admin view:</strong> you see EVERY subject. Each student sees only the subjects included in their own plan.
        </div>
      )}
      {classes.length === 0 ? (
        <div className="card">
          <p className="muted">No downloadable classes on your plan yet.</p>
        </div>
      ) : (
        [...bySubject.entries()].map(([subject, items]) => (
          <div key={subject} style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 10px" }}>
              <span style={{ fontWeight: 800, fontSize: "1.02rem" }}>📁 {subject}</span>
              <span className="muted" style={{ fontSize: ".8rem" }}>({items.length})</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            <div className="sec-list">
              {items.map((c) => (
                <div className="list-row" key={c.id}>
                  <div>
                    <span className="row-title">🔐 {c.title}</span>
                    <p className="row-sub">
                      {c.byte_size ? `${(Number(c.byte_size) / 1e9).toFixed(2)} GB` : ""}
                    </p>
                  </div>
                  <div className="row-actions">
                    {!ready[c.id] && (
                      <button className="btn small secondary" type="button" onClick={() => download(c)}>
                        {labels[c.id] ?? "Download"}
                      </button>
                    )}
                    {ready[c.id] && (
                      <>
                        <button className="btn small" type="button" onClick={() => play(c)}>
                          ▶️ Play
                        </button>
                        {native.remove && (
                          <button className="btn small secondary" type="button" onClick={() => removeDownload(c)} title="Remove from this device">
                            🗑️
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Mobile inline secure player (decrypted temp file via the native plugin). */}
      {playerSrc && (
        <div
          style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column" }}
        >
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
            <span style={{ position: "absolute", bottom: 16, left: 16, color: "rgba(255,255,255,.35)", fontSize: ".75rem", fontWeight: 400, pointerEvents: "none" }}>
              {watermark}
            </span>
          )}
        </div>
      )}
    </>
  );
}
