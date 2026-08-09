"use client";

import { useEffect, useState } from "react";
import { resolveOfflineKey, cacheOfflineKey } from "./licenseCache";
import { nativeFileSrc } from "@/lib/nativeFileSrc";

// When each class finished downloading, on THIS device.
//
// A student who downloads ten classes then has to scroll the whole subject to
// find out whether the first one finished. Downloads are per device, so the
// order they arrived in is per device too — it lives in localStorage, not in
// the database, and it is what the "Downloaded" view is sorted by.
const DL_AT = (id: string) => `dlat:${id}`;
function markDownloaded(id: string) {
  try { localStorage.setItem(DL_AT(id), String(Date.now())); } catch { /* private mode */ }
}
function downloadedAt(id: string): number {
  try { return Number(localStorage.getItem(DL_AT(id))) || 0; } catch { return 0; }
}
function forgetDownloaded(id: string) {
  try { localStorage.removeItem(DL_AT(id)); } catch { /* no-op */ }
}
import OfflinePlayer from "@/app/components/OfflinePlayer";

type Klass = {
  id: string;
  title: string;
  subject_title: string | null;
  storage_url: string;
  iv_b64: string | null;
  alg: string | null;
  byte_size: number | null;
  class_no?: string | null;
  resolution?: string | null;
  section_id?: string | null;
};

// A file size a student can act on. "1.43 GB" answers "will this fit, and how
// long will it take on my data".
function sizeLabel(bytes: number | null | undefined): string {
  const n = Number(bytes) || 0;
  if (!n) return "";
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`;
}

// Best first, so the default choice is the good one.
const QUALITY_ORDER = ["1080p", "720p", "480p", "360p"];
function qualityRank(r: string | null | undefined): number {
  const i = QUALITY_ORDER.indexOf(String(r ?? "720p"));
  return i < 0 ? 99 : i;
}

// Sort "1, 2, 2A, 3, 10" correctly (numeric first, then the part letter).
const classOrder = (c: Klass) => {
  const m = String(c.class_no ?? "").match(/^(\d+)([A-Za-z]?)/);
  return m ? Number(m[1]) * 100 + (m[2] ? m[2].toUpperCase().charCodeAt(0) - 64 : 0) : 999999;
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
  // Until the search gives up we do not know which message is true.
  const [searching, setSearching] = useState(true);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
  // Mobile plays inline in this overlay (desktop opens its own player window).
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerSrc, setPlayerSrc] = useState<string | null>(null);
  // Which of the three views. "Downloaded" is the one students need most and
  // the one that was hardest to get at, so it leads.
  const [view, setView] = useState<"downloaded" | "pending" | "all">("all");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const attach = (n: Native) => {
      setNative(n);
      setSearching(false);
      // Progress arrives on every chunk — far faster than the number on screen
      // can change. Re-rendering the whole list that often makes it flicker,
      // so only a changed whole percent gets through.
      const lastPct: Record<string, number> = {};
      n.onProgress(({ id, received, total }) => {
        const pct = total ? Math.floor((received * 100) / total) : 0;
        if (lastPct[id] === pct) return;
        lastPct[id] = pct;
        setLabels((l) => ({ ...l, [id]: pct >= 100 ? "Downloaded ✓" : `Downloading… ${pct}%` }));
      });
      (async () => {
        const r: Record<string, boolean> = {};
        for (const c of classes) {
          try { r[c.id] = await n.isDownloaded(c.id, c.byte_size ?? undefined); }
          catch { r[c.id] = false; }
        }
        if (!stopped) setReady(r);
      })();
    };

    // Look for a bridge. Returns false while there is still nothing to attach to.
    const find = (): boolean => {
      const w = window as unknown as { native?: Native; Capacitor?: CapGlobal };

      // 1) Desktop app (Electron) — existing bridge.
      const electron = w.native;
      if (electron) { attach(electron); return true; }

      // 2) Mobile app (Capacitor) — adapt OfflineClasses to the same shape.
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
            const src = nativeFileSrc(path, cap.convertFileSrc);
            setPlayerId(id);
            setPlayerSrc(src);
            return true;
          },
        };
        attach(adapter);
        return true;
      }
      return false;
    };

    // KEEP LOOKING. This used to run once, and Capacitor injects its bridge into
    // the WebView asynchronously — so on a slower Android phone the page checked
    // before the plugin had registered, found nothing, and showed the student
    // "offline downloads work inside the app… get the app" WHILE THEY WERE IN
    // THE APP. Their downloaded classes were on the device the whole time.
    if (find()) { setSearching(false); } else {
      timer = setInterval(() => {
        if (stopped || find()) { if (timer) clearInterval(timer); timer = null; }
      }, 250);
      // Give up after 10 seconds: by then it really is a browser.
      setTimeout(() => {
        if (timer) { clearInterval(timer); timer = null; }
        if (!stopped) setSearching(false);
      }, 10000);
    }

    return () => { stopped = true; if (timer) clearInterval(timer); };
  }, [classes]);

  async function download(c: Klass) {
    if (!native) return;
    setLabels((l) => ({ ...l, [c.id]: "Downloading… 0%" }));
    try {
      await native.download(c.id, c.storage_url, c.byte_size ?? undefined);
      cacheOfflineKey(c.id); // mirror the play key now, while online — enables airplane-mode playback
      markDownloaded(c.id);
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
      setLabels((l) => ({ ...l, [c.id]: "Preparing… ⏳ (first play only — replays start instantly)" }));
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
      forgetDownloaded(c.id);
      setReady((r) => ({ ...r, [c.id]: false }));
      setLabels((l) => ({ ...l, [c.id]: "Download" }));
    } catch (e) {
      alert("Could not remove: " + (e as Error).message);
    }
  }

  if (!native && searching) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: "2.2rem" }}>📥</div>
        <p className="muted" style={{ margin: "8px 0 0" }}>Looking for your downloaded classes…</p>
      </div>
    );
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

  // One entry per CLASS, carrying every quality prepared for it. The list used
  // to show one row per file, so a class prepared at two qualities appeared
  // twice with no way to tell which was which.
  const byClass = new Map<string, Klass[]>();
  for (const c of classes) {
    const k = (c.section_id as string | undefined) ?? c.id;
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k)!.push(c);
  }
  for (const v of byClass.values()) v.sort((a, b) => qualityRank(a.resolution) - qualityRank(b.resolution));

  const doneCount = classes.filter((c) => ready[c.id]).length;
  const pendingCount = classes.length - doneCount;

  // The DOWNLOADED view is a flat list in the order they arrived, deliberately
  // NOT grouped by subject and NOT in class order. A student who has just
  // downloaded four classes wants the newest at the top, not to hunt through
  // folders for the one that finished a minute ago. The class sequence is
  // broken here on purpose — the other two views keep it.
  const downloaded = classes
    .filter((c) => ready[c.id])
    .sort((a, b) => (downloadedAt(b.id) || 0) - (downloadedAt(a.id) || 0));

  const listed = view === "downloaded" ? downloaded : view === "pending" ? classes.filter((c) => !ready[c.id]) : classes;

  // Folder view: one section per subject (students only ever receive the
  // subjects on their plan — admins receive everything, hence the note).
  const bySubject = new Map<string, Klass[]>();
  for (const c of listed) {
    const k = c.subject_title ?? "Other";
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k)!.push(c);
  }
  for (const items of bySubject.values()) items.sort((a, b) => classOrder(a) - classOrder(b));

  const TABS = [
    { key: "downloaded" as const, label: `⬇️ Downloaded`, n: doneCount },
    { key: "pending" as const, label: `☁️ Not downloaded`, n: pendingCount },
    { key: "all" as const, label: `📚 All classes`, n: classes.length },
  ];

  return (
    <>
      {isAdmin && (
        <div className="notice ok" style={{ fontSize: ".82rem", marginBottom: 14 }}>
          👑 <strong>Admin view:</strong> you see EVERY subject. Each student sees only the subjects included in their own plan.
        </div>
      )}
      {/* Three views. Downloaded first, because that is the one a student comes
          back to and the one that used to mean scrolling a whole subject. */}
      {classes.length > 0 && pendingCount > 0 && (
        <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
          Tap Download on as many classes as you like — they come down <strong>one at a time</strong>, so the first
          one is ready to watch while the rest arrive. Downloading four at once made all four crawl.
        </p>
      )}
      {classes.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`btn small ${view === t.key ? "" : "secondary"}`}
              onClick={() => setView(t.key)}
            >
              {t.label} ({t.n})
            </button>
          ))}
        </div>
      )}

      {classes.length === 0 ? (
        <div className="card">
          <p className="muted">No downloadable classes on your plan yet.</p>
        </div>
      ) : listed.length === 0 ? (
        <div className="card">
          <p className="muted">
            {view === "downloaded"
              ? "Nothing downloaded on this device yet. Open “All classes” and download the ones you want to watch offline."
              : "Every class on your plan is already downloaded on this device. 🎉"}
          </p>
        </div>
      ) : view === "downloaded" ? (
        // Flat, newest first. No folders, no class numbering — the thing you
        // just downloaded is the thing at the top.
        <div className="sec-list">
          {downloaded.map((c) => (
            <div className="list-row" key={c.id}>
              <div>
                <span className="row-title">✅ {c.class_no ? `Class ${c.class_no} · ` : ""}{c.title}</span>
                <p className="row-sub">
                  {c.subject_title ? `${c.subject_title} · ` : ""}
                  {c.byte_size ? `${(Number(c.byte_size) / 1e9).toFixed(2)} GB` : ""}
                  {downloadedAt(c.id) ? ` · downloaded ${new Date(downloadedAt(c.id)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                </p>
              </div>
              <div className="row-actions">
                <button className="btn small" type="button" onClick={() => play(c)}>▶️ Play</button>
                {native.remove && (
                  <button className="btn small secondary" type="button" onClick={() => removeDownload(c)} title="Remove from this device">🗑️</button>
                )}
              </div>
            </div>
          ))}
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
              {(() => { const shown = new Set<string>(); return items.map((c) => {
                // Every quality prepared for this class, best first.
                const key = (c.section_id as string) ?? c.id;
                // Show the class ONCE. This used to anchor on the BEST quality
                // row — but in the "not downloaded" view that row is filtered
                // out as soon as it has been downloaded, so the whole class
                // silently disappeared from the list. Anchor on whichever of
                // its rows arrives first instead.
                if (shown.has(key)) return null;
                shown.add(key);
                const variants = byClass.get(key) ?? [c];
                const got = variants.filter((v) => ready[v.id]);
                const missing = variants.filter((v) => !ready[v.id]);
                return (
                <div className="list-row" key={c.id}>
                  <div>
                    <span className="row-title">{got.length ? "✅" : "🔐"} {c.class_no ? `Class ${c.class_no} · ` : ""}{c.title}</span>
                    <p className="row-sub">
                      {got.length
                        ? `On this device at ${got.map((v) => v.resolution ?? "720p").join(", ")}${missing.length ? " · another size is available below" : ""}`
                        : variants.length > 1
                          ? "Choose a quality — smaller files download faster and use less data"
                          : sizeLabel(c.byte_size)}
                    </p>
                  </div>
                  <div className="row-actions" style={{ flexWrap: "wrap", gap: 6 }}>
                    {/* Play what is here, and STILL offer what is not.
                        Downloading 720p used to hide every other size for that
                        class for ever — so a student who grabbed the big one on
                        wifi could never take the small one for the train. Each
                        quality now stands on its own. */}
                    {got.map((v) => (
                      <button key={v.id} className="btn small" type="button" onClick={() => play(v)}>
                        ▶️ Play {variants.length > 1 ? (v.resolution ?? "720p") : ""}
                      </button>
                    ))}
                    {missing.map((v) => (
                      <button
                        key={v.id}
                        className={`btn small ${v.id === missing[0].id && !got.length ? "" : "secondary"}`}
                        type="button"
                        onClick={() => download(v)}
                        title={`${v.resolution ?? "720p"} — ${sizeLabel(v.byte_size)}`}
                      >
                        {labels[v.id] ?? `⬇️ ${v.resolution ?? "720p"}${sizeLabel(v.byte_size) ? ` · ${sizeLabel(v.byte_size)}` : ""}`}
                      </button>
                    ))}
                    {got.length > 0 && native.remove && (
                      <button className="btn small secondary" type="button" onClick={() => removeDownload(got[0])} title="Remove from this device">🗑️</button>
                    )}
                  </div>
                </div>
                );
              }); })()}
            </div>
          </div>
        ))
      )}

      {/* Secure offline player: custom controls, watermark survives fullscreen. */}
      {playerSrc && <OfflinePlayer src={playerSrc} classId={playerId ?? undefined} watermark={watermark} onClose={() => setPlayerSrc(null)} />}
    </>
  );
}
