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

  // DO NOT TELL SOMEBODY TO RELOAD WHEN RELOADING CANNOT HELP.
  //
  // This screen said "the site was just updated — this page needs a quick
  // refresh" for EVERY error, whatever it was. When a genuine bug reached it,
  // the founder reloaded, hit the same bug, was told the same thing, and
  // reloaded again: the page appeared to be stuck rather than broken, and the
  // real fault stayed invisible. A stale chunk after a deploy really does heal
  // on reload; nothing else does. So only that case makes the claim.
  const stale = isStaleChunk(error);

  return (
    <section className="container" style={{ paddingTop: 60, paddingBottom: 60, maxWidth: 560, textAlign: "center" }}>
      <h2>{stale ? "🔄 One moment…" : "⚠ Something on this page failed"}</h2>
      <p className="muted" style={{ lineHeight: 1.7 }}>
        {stale
          ? "The site was just updated — this page needs a quick refresh."
          : "This is a fault on our side, not something you did, and reloading will not clear it. It has been logged."}
      </p>
      {/* The digest is what turns "it broke" into a line in the server log.
          Without it, reporting a fault means describing a blank screen. */}
      {!stale && error?.digest && (
        <p className="muted" style={{ fontSize: ".78rem", marginTop: 8 }}>
          Quote this when reporting it: <code>{error.digest}</code>
        </p>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
        {stale && <button className="btn" onClick={() => window.location.reload()}>Reload page</button>}
        <button className={stale ? "btn secondary" : "btn"} onClick={() => reset()}>Try again</button>
        {!stale && <a className="btn secondary" href="/support">Tell us what you were doing</a>}
      </div>
    </section>
  );
}
