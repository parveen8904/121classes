"use client";

import { useRef, useState } from "react";
import { askDoubt } from "../../section/[sectionId]/testActions";
import Help from "@/app/components/Help";

// Read a file → base64 (images downscaled to keep the payload small & cheap).
async function fileToAttachment(file: File): Promise<{ dataB64: string; mediaType: string }> {
  if (file.type === "application/pdf") {
    if (file.size > 6 * 1024 * 1024) throw new Error("PDF too large — keep it under 6 MB.");
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
    return { dataB64: btoa(bin), mediaType: "application/pdf" };
  }
  if (!file.type.startsWith("image/")) throw new Error("Please attach an image or a PDF.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read the image")); i.src = url; });
    const scale = Math.min(1, 1600 / (img.width || 1600));
    const w = Math.max(1, Math.round((img.width || 1600) * scale));
    const h = Math.max(1, Math.round((img.height || 1600) * scale));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unsupported");
    ctx.drawImage(img, 0, 0, w, h);
    return { dataB64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

export default function DoubtBox({ sectionId }: { sectionId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function ask() {
    if (!question.trim() && !file) return;
    setBusy(true);
    setAnswer(null);
    setPending(false);
    setErr(null);
    try {
      let attachment: { dataB64: string; mediaType: string } | null = null;
      if (file) {
        try { attachment = await fileToAttachment(file); }
        catch (e) { setErr((e as Error).message); return; }
      }
      const r = await askDoubt({ sectionId, question, attachment });
      if (!r.ok) { alert("Could not submit your doubt. Please try again."); return; }
      if (r.answer) setAnswer(r.answer);
      else setPending(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <textarea
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Type your doubt — or attach a photo of the question"
      />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment"
        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }} style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <button className="btn small" type="button" disabled={busy || (!question.trim() && !file)} onClick={ask}>
          {busy ? "Thinking…" : "Ask 💬"}
        </button>
        <button className="btn small secondary" type="button" onClick={() => fileRef.current?.click()}>
          📎 Attach image / PDF
        </button>
        {file && (
          <span className="muted" style={{ fontSize: ".82rem" }}>
            📄 {file.name.slice(0, 24)} <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} style={{ background: "none", border: 0, color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>✕</button>
          </span>
        )}
        <Help text="Type your doubt or attach a photo/PDF of the question. You'll get an instant answer based on CA Parveen Sharma's material. If it needs the faculty, it's forwarded to them." />
      </div>
      {err && <p style={{ color: "#dc2626", fontSize: ".82rem", margin: "0 0 8px" }}>{err}</p>}

      {answer && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted" style={{ fontSize: ".78rem", marginBottom: 6 }}>🤖 AI assistant</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{answer}</p>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 10 }}>
            Guided by CA Parveen Sharma&apos;s team. Double-check anything important with your faculty.
          </p>
        </div>
      )}
      {pending && (
        <p className="muted" style={{ marginTop: 10, fontSize: ".88rem" }}>
          ✅ Submitted! Our faculty will review your doubt and respond soon.
        </p>
      )}
    </div>
  );
}
