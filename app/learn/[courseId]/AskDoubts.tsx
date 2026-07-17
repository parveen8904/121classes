"use client";

import { useRef, useState, useTransition } from "react";
import { askSubjectDoubt } from "./doubt-actions";

// Read a file → base64 (images downscaled to keep the payload small & cheap).
async function fileToAttachment(file: File): Promise<{ dataB64: string; mediaType: string } | null> {
  if (file.type === "application/pdf") {
    if (file.size > 6 * 1024 * 1024) throw new Error("PDF too large — please keep it under 6 MB.");
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
    return { dataB64: btoa(bin), mediaType: "application/pdf" };
  }
  if (!file.type.startsWith("image/")) throw new Error("Please attach an image or a PDF.");
  // Downscale big photos to max 1600px, JPEG.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read the image")); i.src = url; });
    const scale = Math.min(1, 1600 / (img.width || 1600));
    const w = Math.max(1, Math.round((img.width || 1600) * scale));
    const h = Math.max(1, Math.round((img.height || 1600) * scale));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unsupported");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { dataB64: dataUrl.split(",")[1], mediaType: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

// The prominent, flashing "Ask your doubts" button on each subject. AI answers
// the subject doubt instantly; if the student isn't satisfied, they can forward
// the exact question to the faculty on WhatsApp or email.
export default function AskDoubts({
  subjectId,
  subjectTitle,
  courseId,
  facultyHasWhatsApp,
  facultyEmail,
}: {
  subjectId: string;
  subjectTitle: string;
  courseId: string;
  facultyHasWhatsApp?: boolean;
  facultyEmail?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [limited, setLimited] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // WhatsApp goes through the server bridge (/api/faculty-wa) so the faculty
  // number is never exposed in the page. The student's doubt is pre-filled.
  const wa = facultyHasWhatsApp
    ? `/api/faculty-wa?subject=${encodeURIComponent(subjectId)}`
    : null;

  function close() {
    setOpen(false);
    setAsked(false);
    setAnswer(null);
    setLimited(false);
    setQ("");
    setFile(null);
    setFileErr(null);
  }

  function submit() {
    setFileErr(null);
    start(async () => {
      let attachment: { dataB64: string; mediaType: string } | null = null;
      if (file) {
        try { attachment = await fileToAttachment(file); }
        catch (e) { setFileErr((e as Error).message); return; }
      }
      const r = await askSubjectDoubt({ subjectId, question: q, attachment });
      setAnswer(r.ok ? r.answer : null);
      setLimited(!!r.limited);
      setUpgrade(!!r.upgrade);
      setAsked(true);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="askdoubts-flash"
        style={{
          border: "none",
          borderRadius: 999,
          padding: "8px 14px",
          fontWeight: 700,
          fontSize: ".85rem",
          color: "#fff",
          cursor: "pointer",
          background: "#16a34a",
        }}
      >
        💬 Ask your doubts
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 4, border: "2px solid var(--accent)", position: "relative" }}>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", fontSize: "1.3rem", lineHeight: 1, cursor: "pointer", color: "var(--muted)" }}
      >
        ×
      </button>
      {!asked ? (
        <>
          <strong>💬 Ask your doubt — {subjectTitle}</strong>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 8px" }}>
            Type your doubt for an <strong>instant reply</strong>. Not satisfied? You can send it to the faculty on WhatsApp or email.
          </p>
          <textarea
            rows={3}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. How is a current investment valued under AS 13? — or attach a photo of the question"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
          />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setFileErr(null); }} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn small secondary" type="button" onClick={() => fileRef.current?.click()}>
              📎 Attach image / PDF
            </button>
            {file && (
              <span className="muted" style={{ fontSize: ".82rem" }}>
                📄 {file.name.slice(0, 28)} <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} style={{ background: "none", border: 0, color: "#dc2626", cursor: "pointer", fontWeight: 700 }}>✕</button>
              </span>
            )}
          </div>
          {fileErr && <p style={{ color: "#dc2626", fontSize: ".82rem", margin: "6px 0 0" }}>{fileErr}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn" type="button" disabled={pending || (q.trim().length < 3 && !file)} onClick={submit}>
              {pending ? "Thinking…" : "Get instant reply ⚡"}
            </button>
            <button className="btn secondary" type="button" onClick={close}>Close</button>
          </div>
        </>
      ) : (
        <>
          {upgrade ? (
            <div className="notice" style={{ marginTop: 0, marginRight: 24, background: "var(--bg-soft)" }}>
              🔒 You&apos;ve used all your free doubts. <a href={`/learn/${courseId}/plans`} style={{ fontWeight: 700 }}>Upgrade to Silver or Gold</a> to keep asking unlimited questions.
            </div>
          ) : limited ? (
            <p className="muted" style={{ marginTop: 0, marginRight: 24 }}>🙏 You&apos;ve reached today&apos;s limit of 20 questions. Continue tomorrow, or send this doubt to the faculty below.</p>
          ) : answer ? (
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: 0 }}>{answer}</p>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>I couldn&apos;t answer this from your class material — please send it to the faculty below.</p>
          )}
          <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0 6px" }}>Not satisfied? Send this doubt to the faculty:</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {wa && (
              <a className="btn small" href={`${wa}&text=${encodeURIComponent(`Doubt (${subjectTitle}): ${q}`)}`} target="_blank" rel="noopener noreferrer"
                style={{ background: "#25D366", color: "#fff" }}>
                💬 Send to faculty (WhatsApp)
              </a>
            )}
            {facultyEmail && (
              <a className="btn small secondary" href={`mailto:${facultyEmail}?subject=${encodeURIComponent(`Doubt — ${subjectTitle}`)}&body=${encodeURIComponent(q)}`}>
                ✉️ Email the faculty
              </a>
            )}
            <button className="btn small secondary" type="button" onClick={() => { setAsked(false); setAnswer(null); setQ(""); }}>
              Ask another
            </button>
          </div>
        </>
      )}
    </div>
  );
}
