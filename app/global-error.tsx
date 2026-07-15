"use client";

import { useEffect } from "react";

// Root error boundary (catches crashes in the root layout itself). Same
// self-heal as app/error.tsx: stale-chunk errors after a deploy get one
// silent reload; anything else shows a friendly retry screen.
function autoHeal(error: unknown): boolean {
  try {
    const m = String((error as Error)?.message ?? error ?? "");
    if (!/ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(m)) return false;
    const last = Number(sessionStorage.getItem("errboundary.reload") || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem("errboundary.reload", String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { autoHeal(error); }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0b1220", color: "#e2e8f0", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 460 }}>
          <h2 style={{ marginTop: 0 }}>🔄 One moment…</h2>
          <p style={{ color: "#94a3b8" }}>The site was just updated — this page needs a quick refresh.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#0d9488", color: "#fff", border: "none", padding: "12px 22px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
