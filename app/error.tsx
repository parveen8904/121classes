"use client";

import { useEffect } from "react";

// Route-level error boundary. The most common client crash on a busy deploy
// day is a STALE-CHUNK error: an open tab asks for JS files of the previous
// build, which no longer exist. That heals with one reload — do it silently
// (guarded so a genuine crash can't loop).
function isStaleChunk(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err ?? "");
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(m);
}

function autoHeal(error: unknown): boolean {
  try {
    if (!isStaleChunk(error)) return false;
    const last = Number(sessionStorage.getItem("errboundary.reload") || 0);
    if (Date.now() - last < 60_000) return false; // already tried in the last minute
    sessionStorage.setItem("errboundary.reload", String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { autoHeal(error); }, [error]);

  return (
    <section className="container" style={{ paddingTop: 60, paddingBottom: 60, maxWidth: 520, textAlign: "center" }}>
      <h2>🔄 One moment…</h2>
      <p className="muted">
        The site was just updated — this page needs a quick refresh.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
        <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
        <button className="btn secondary" onClick={() => reset()}>Try again</button>
      </div>
    </section>
  );
}
