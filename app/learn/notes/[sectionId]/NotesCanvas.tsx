"use client";

import { useEffect, useRef, useState } from "react";

// View-only PDF: pages are drawn onto <canvas> images (no browser PDF toolbar,
// no download/save button, right-click disabled). Combined with the moving
// watermark this makes casual saving/sharing of notes impractical.
export default function NotesCanvas({ fileUrl }: { fileUrl: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState("");

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
      style={{ height: "100%", overflowY: "auto", padding: 10, background: "#222" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state === "loading" && <p style={{ color: "#aaa", textAlign: "center", marginTop: 30 }}>{progress || "Opening notes…"}</p>}
      {state === "error" && <p style={{ color: "#f88", textAlign: "center", marginTop: 30 }}>Couldn&apos;t open these notes. Please try again.</p>}
      <div ref={wrapRef} style={{ maxWidth: 1000, margin: "0 auto" }} />
    </div>
  );
}
