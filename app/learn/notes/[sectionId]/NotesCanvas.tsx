"use client";

import { useEffect, useRef, useState } from "react";

// View-only PDF: pages are drawn onto <canvas> images (no browser PDF toolbar,
// no download/save button, right-click disabled). Combined with the moving
// watermark this makes casual saving/sharing of notes impractical.
export default function NotesCanvas({ fileUrl }: { fileUrl: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState("");
  // Zoom is pure CSS width on the page container (the canvases render at
  // 1.2–1.5× device pixels, so up to ~200% stays sharp). 100% = fit width.
  const [zoom, setZoom] = useState(100);
  const zoomIn = () => setZoom((z) => Math.min(300, z + 25));
  const zoomOut = () => setZoom((z) => Math.max(50, z - 25));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Worker served from our own /public (copied from pdfjs-dist on install).
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjs.getDocument({ url: fileUrl }).promise;
        const wrap = wrapRef.current;
        if (!wrap || cancelled) return;
        wrap.innerHTML = "";
        const width = Math.min(wrap.clientWidth || 800, 1000);

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          setProgress(`Loading page ${i} of ${doc.numPages}…`);
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (width / base.width) * (window.devicePixelRatio > 1 ? 1.5 : 1.2);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.display = "block";
          canvas.style.marginBottom = "10px";
          canvas.style.borderRadius = "6px";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          wrap.appendChild(canvas);
        }
        setProgress("");
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  return (
    <div
      style={{ position: "relative", height: "100%", overflowY: "auto", overflowX: "auto", padding: 10, background: "#222" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Zoom controls — read tiny figures comfortably. */}
      {state === "ready" && (
        <div
          style={{
            position: "sticky", top: 0, zIndex: 5, display: "flex", gap: 6, justifyContent: "center",
            padding: "4px 0 8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(0,0,0,.72)", borderRadius: 999, padding: "4px 8px" }}>
            <button type="button" onClick={zoomOut} aria-label="Zoom out" style={{ background: "#444", color: "#fff", border: 0, borderRadius: "50%", width: 30, height: 30, fontSize: "1.1rem", cursor: "pointer", lineHeight: 1 }}>−</button>
            <button type="button" onClick={() => setZoom(100)} style={{ background: "transparent", color: "#fff", border: 0, minWidth: 52, fontWeight: 700, cursor: "pointer", fontSize: ".85rem" }}>
              {zoom}%
            </button>
            <button type="button" onClick={zoomIn} aria-label="Zoom in" style={{ background: "#444", color: "#fff", border: 0, borderRadius: "50%", width: 30, height: 30, fontSize: "1.1rem", cursor: "pointer", lineHeight: 1 }}>＋</button>
          </div>
        </div>
      )}
      {state === "loading" && <p style={{ color: "#aaa", textAlign: "center", marginTop: 30 }}>{progress || "Opening notes…"}</p>}
      {state === "error" && <p style={{ color: "#f88", textAlign: "center", marginTop: 30 }}>Couldn&apos;t open these notes. Please try again.</p>}
      <div
        ref={wrapRef}
        style={
          zoom === 100
            ? { maxWidth: 1000, margin: "0 auto" }
            : { width: `${zoom}%`, minWidth: zoom > 100 ? `${zoom}%` : undefined, maxWidth: zoom < 100 ? 1000 * (zoom / 100) : undefined, margin: "0 auto" }
        }
      />
    </div>
  );
}
