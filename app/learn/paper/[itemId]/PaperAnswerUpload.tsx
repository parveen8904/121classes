"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitPaperAnswer } from "./actions";

// Student uploads their own answer (a PDF, or photos of handwritten pages that
// we stitch into a PDF), which lands in the PRIVATE "secure" bucket. Then the
// AI evaluates it against the suggested answers.
export default function PaperAnswerUpload({ itemId, canEvaluate }: { itemId: string; canEvaluate: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supabase = createClient();

  async function fileToJpeg(file: File): Promise<Uint8Array> {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.82)!);
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true); setMsg("Preparing…");
    try {
      let blob: Blob;
      if (files.length === 1 && files[0].type === "application/pdf") {
        blob = files[0];
      } else {
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.create();
        for (const f of files) {
          const jpg = await fileToJpeg(f);
          const im = await pdf.embedJpg(jpg);
          const pg = pdf.addPage([im.width, im.height]);
          pg.drawImage(im, { x: 0, y: 0, width: im.width, height: im.height });
        }
        blob = new Blob([(await pdf.save()) as BlobPart], { type: "application/pdf" });
      }
      setMsg("Uploading…");
      const path = `paper/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
      const { error } = await supabase.storage.from("secure").upload(path, blob, { contentType: "application/pdf", upsert: true });
      if (error) { setMsg("Upload failed — please try again."); return; }
      setMsg(canEvaluate ? "Evaluating with AI…" : "Submitting…");
      await submitPaperAnswer({ itemId, fileUrl: `secure:${path}` });
      setMsg("✅ Submitted! Refreshing your result…");
      window.location.reload();
    } catch {
      setMsg("Something went wrong — please try again.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <label className="btn" style={{ cursor: "pointer", margin: 0 }}>
        {busy ? "Working…" : "📤 Upload my answers (PDF or photos)"}
        <input type="file" accept="application/pdf,image/*" multiple onChange={onFiles} style={{ display: "none" }} disabled={busy} />
      </label>
      {msg && <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>{msg}</p>}
    </div>
  );
}
