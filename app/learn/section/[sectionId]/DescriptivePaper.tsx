"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startPaperAttempt, submitPaperAttempt, gradePaperNow, resetMyPaperAttempt, type PaperAttempt } from "./paperActions";
import { viaProxy } from "@/lib/fileProxy";

type Props = {
  sectionId: string;
  studentId: string;
  title: string;
  questionPdf: string;
  solutionPdf: string;
  durationMinutes: number;
  totalMarks: number;
  instructions: string;
  initial: PaperAttempt;
  isAdmin?: boolean;
};

function fmtClock(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Convert any image (incl. large phone photos) to a downscaled JPEG byte array.
async function fileToJpegBytes(file: File, maxW = 1600): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not read an image"));
      i.src = url;
    });
    const scale = Math.min(1, maxW / (img.width || maxW));
    const w = Math.max(1, Math.round((img.width || maxW) * scale));
    const h = Math.max(1, Math.round((img.height || maxW) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.82));
    if (!blob) throw new Error("Could not process an image");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imagesToPdfBlob(files: File[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const f of files) {
    const jpg = await fileToJpegBytes(f);
    const img = await pdf.embedJpg(jpg);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

async function uploadPdf(blob: Blob, path: string): Promise<string | null> {
  const supabase = createClient();
  // Answer sheets are personal — upload to the PRIVATE "secure" bucket and
  // store a "secure:<path>" reference (served only via signed URLs, never a
  // public link).
  const { error } = await supabase.storage.from("secure").upload(path, blob, { contentType: "application/pdf", upsert: true });
  if (error) return null;
  return `secure:${path}`;
}

export default function DescriptivePaper(props: Props) {
  const { sectionId, studentId, title, solutionPdf, durationMinutes, totalMarks, instructions } = props;
  const [attempt, setAttempt] = useState<PaperAttempt>(props.initial);
  const [questionPdf, setQuestionPdf] = useState(props.questionPdf);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // In the iPhone/Android app, pop-up windows lose the login session (they open
  // outside the app) — the question paper then shows a "login required" error.
  // There we navigate in the SAME view instead (edge-swipe returns to the test).
  const [nativeApp, setNativeApp] = useState(false);
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    setNativeApp(!!cap?.isNativePlatform?.());
  }, []);
  const fileTarget = nativeApp ? undefined : "_blank";
  // In the app, PDFs open in our viewer page (has a ← Back header); on the web
  // they open in a new tab as usual.
  const fileHref = (url: string, label: string) =>
    nativeApp ? `/learn/pdf?u=${encodeURIComponent(url)}&t=${encodeURIComponent(label)}` : viaProxy(url);
  const openFile = (url: string) => {
    if (nativeApp) window.location.assign(fileHref(url, "Question paper"));
    else window.open(viaProxy(url), "_blank", "noopener,noreferrer");
  };

  // ---- countdown ----
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    attempt.deadlineAt ? Math.round((new Date(attempt.deadlineAt).getTime() - Date.now()) / 1000) : 0,
  );
  useEffect(() => {
    if (attempt.status !== "started") return;
    setSecondsLeft(Math.round((new Date(attempt.deadlineAt || 0).getTime() - Date.now()) / 1000));
    const t = setInterval(() => {
      const left = Math.round((new Date(attempt.deadlineAt || 0).getTime() - Date.now()) / 1000);
      setSecondsLeft(left);
      if (left <= 0) setAttempt((a) => (a.status === "started" ? { ...a, status: "expired" } : a));
    }, 1000);
    return () => clearInterval(t);
  }, [attempt.status, attempt.deadlineAt]);

  // ---- start (= download the question paper) ----
  async function start() {
    setBusy(true);
    setNote(null);
    try {
      const r = await startPaperAttempt(sectionId);
      if (r.questionPdf) setQuestionPdf(r.questionPdf);
      setAttempt(r);
      if (r.questionPdf) openFile(r.questionPdf);
    } finally {
      setBusy(false);
    }
  }

  // ---- the photo → PDF uploader ----
  const [pics, setPics] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setPics((p) => [...p, ...Array.from(list)]);
    if (fileRef.current) fileRef.current.value = "";
  };
  const move = (i: number, dir: -1 | 1) =>
    setPics((p) => {
      const n = [...p];
      const j = i + dir;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const removeAt = (i: number) => setPics((p) => p.filter((_, k) => k !== i));

  async function submit() {
    if (!pics.length) {
      setNote("Add at least one photo of your answer pages first.");
      return;
    }
    setBusy(true);
    setNote("Building your PDF…");
    try {
      const blob = await imagesToPdfBlob(pics);
      setNote("Uploading…");
      const url = await uploadPdf(blob, `descriptive/${sectionId}/${studentId}-${Date.now()}.pdf`);
      if (!url) {
        setNote("Upload failed — please check your connection and try again.");
        setBusy(false);
        return;
      }
      setNote("Submitted! Checking your paper… (this can take up to a minute)");
      const r = await submitPaperAttempt({ sectionId, fileUrl: url });
      setAttempt(r);
      setPics([]);
      setNote(null);
    } catch {
      setNote("Something went wrong while making the PDF. Try with clearer photos.");
    } finally {
      setBusy(false);
    }
  }

  // ---- trial upload (practice) ----
  const [trialMsg, setTrialMsg] = useState<string | null>(null);
  const [trialPics, setTrialPics] = useState<File[]>([]);
  const trialRef = useRef<HTMLInputElement>(null);
  async function tryUpload() {
    if (!trialPics.length) {
      setTrialMsg("Pick 2–3 photos of anything to test the upload.");
      return;
    }
    setTrialMsg("Building & uploading a test PDF…");
    try {
      const blob = await imagesToPdfBlob(trialPics);
      const url = await uploadPdf(blob, `descriptive/trial/${studentId}-${Date.now()}.pdf`);
      setTrialMsg(url ? "✅ It works! Your phone/computer can take photos, make a PDF and upload. You're ready." : "Upload failed — check your connection and try again.");
    } catch {
      setTrialMsg("Couldn't process those images — try normal photos (JPG/PNG).");
    }
  }

  const regrade = useCallback(async () => {
    setBusy(true);
    try {
      setAttempt(await gradePaperNow(sectionId));
    } finally {
      setBusy(false);
    }
  }, [sectionId]);

  const card: React.CSSProperties = { marginTop: 16 };
  const totalAllowed = durationMinutes + 10;

  // ===== REPORT (graded) =====
  if (attempt.status === "graded" && attempt.report) {
    const r = attempt.report;
    const pct = r.total ? Math.round((r.awarded / r.total) * 100) : 0;
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="card" style={{ border: "2px solid var(--accent)" }}>
          <h3 style={{ marginTop: 0 }}>{pct >= 50 ? "🎉 Well done!" : "📝 Keep practising!"}</h3>
        {attempt.examinerName && (
          <p style={{ margin: "6px 0 0", fontWeight: 600 }}>🧑‍🏫 Checked &amp; verified by {attempt.examinerName}{attempt.examinerRemarks ? <> — <span style={{ fontWeight: 400 }}>&ldquo;{attempt.examinerRemarks}&rdquo;</span></> : null}</p>
        )}
          <p style={{ fontSize: "1.5rem", fontWeight: 800, margin: "6px 0" }}>
            {r.awarded} / {r.total} <span className="muted" style={{ fontSize: "1rem" }}>({pct}%)</span>
          </p>
          {r.summary && <p style={{ margin: "4px 0 0" }}>{r.summary}</p>}
          {r.unreadable && <p className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>⚠️ Part of the handwriting was hard to read — if marks look off, ask the faculty to review.</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {attempt.annotatedUrl && <a className="btn small" href={fileHref(attempt.annotatedUrl, "My checked copy")} target={fileTarget} rel="noopener noreferrer">📝 My checked copy (marks &amp; notes)</a>}
            {attempt.fileUrl && <a className="btn small secondary" href={fileHref(attempt.fileUrl, "My uploaded answers")} target={fileTarget} rel="noopener noreferrer">📄 My uploaded answers</a>}
            {questionPdf && <a className="btn small secondary" href={fileHref(questionPdf, "Question paper")} target={fileTarget} rel="noopener noreferrer">📄 Question paper</a>}
            {solutionPdf && <a className="btn small secondary" href={fileHref(solutionPdf, "Official solution")} target={fileTarget} rel="noopener noreferrer">✅ Official solution (PDF)</a>}
            {props.isAdmin && (
              <button className="btn small secondary" type="button" disabled={busy} onClick={async () => { setBusy(true); try { setAttempt(await resetMyPaperAttempt(sectionId)); } finally { setBusy(false); } }}>
                🔄 Reset (admin preview)
              </button>
            )}
          </div>
        </div>

        {r.per_question.length > 0 && (
          <div className="card">
            <strong>📋 Marks per question</strong>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {r.per_question.map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                  <span><strong>{p.q || `Q${i + 1}`}</strong> {p.comment && <span className="muted" style={{ fontSize: ".85rem" }}>— {p.comment}</span>}</span>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{p.awarded}/{p.max}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {r.improvements.length > 0 && (
          <div className="card">
            <strong>🎯 Where to improve</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{r.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {r.concepts_to_revise.length > 0 && (
          <div className="card">
            <strong>🔎 Concepts to revise</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{r.concepts_to_revise.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
      </div>
    );
  }

  // ===== SUBMITTED but not yet graded =====
  if (attempt.status === "submitted") {
    return (
      <div className="card" style={{ border: "2px solid var(--accent)" }}>
        <h3 style={{ marginTop: 0 }}>✅ Your paper is submitted</h3>
        {attempt.underReview ? (
          <p className="muted">🧑‍🏫 Your copy is being evaluated by the examiner. Your checked copy, marks and feedback will appear here as soon as the examiner releases them — we&apos;ll also email you.</p>
        ) : (
          <p className="muted">We&apos;re checking it against the solution. This usually takes under a minute.</p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {!attempt.underReview && <button className="btn small" type="button" disabled={busy} onClick={regrade}>{busy ? "Checking…" : "🔄 Show my result"}</button>}
          {attempt.fileUrl && <a className="btn small secondary" href={fileHref(attempt.fileUrl, "My uploaded answers")} target={fileTarget} rel="noopener noreferrer">📄 My uploaded answers</a>}
          {solutionPdf && <a className="btn small secondary" href={fileHref(solutionPdf, "Official solution")} target={fileTarget} rel="noopener noreferrer">✅ Official solution (PDF)</a>}
        </div>
      </div>
    );
  }

  // ===== EXPIRED (didn't upload in time) =====
  if (attempt.status === "expired") {
    return (
      <div className="card" style={{ border: "2px solid #ef4444" }}>
        <h3 style={{ marginTop: 0 }}>⏰ Time over</h3>
        <p className="muted">The upload window for this paper has closed, so it can no longer be submitted. You can still study the question paper and the official solution.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {questionPdf && <a className="btn small" href={fileHref(questionPdf, "Question paper")} target={fileTarget} rel="noopener noreferrer">📄 Question paper</a>}
          {solutionPdf && <a className="btn small secondary" href={fileHref(solutionPdf, "Official solution")} target={fileTarget} rel="noopener noreferrer">✅ Official solution (PDF)</a>}
          {props.isAdmin && (
            <button className="btn small secondary" type="button" disabled={busy} onClick={async () => { setBusy(true); try { setAttempt(await resetMyPaperAttempt(sectionId)); } finally { setBusy(false); } }}>
              🔄 Reset (admin preview)
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===== STARTED — solving / uploading =====
  if (attempt.status === "started") {
    const low = secondsLeft <= 120;
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="card" style={{ border: low ? "2px solid #ef4444" : "2px solid var(--accent)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, position: "sticky", top: 8, zIndex: 2 }}>
          <strong>⏱️ Time left to upload</strong>
          <span style={{ fontWeight: 800, fontSize: "1.3rem", color: low ? "#ef4444" : "var(--text)" }}>{fmtClock(secondsLeft)}</span>
        </div>
        {low && <div className="notice" style={{ background: "rgba(239,68,68,.12)", color: "#fca5a5", margin: 0 }}>⚠️ Less than 2 minutes! Upload now — after the timer the upload closes.</div>}

        <div className="card">
          <strong>1) Your question paper</strong>
          <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 8px" }}>Solve it on paper, then photograph each page.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {questionPdf && <a className="btn small" href={fileHref(questionPdf, "Question paper")} target={fileTarget} rel="noopener noreferrer">📄 Open question paper</a>}
            {props.isAdmin && (
              <button className="btn small secondary" type="button" disabled={busy} onClick={async () => { setBusy(true); try { setAttempt(await resetMyPaperAttempt(sectionId)); } finally { setBusy(false); } }}>
                🔄 Reset (admin preview)
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <strong>2) Upload your handwritten answers</strong>
          <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 10px" }}>
            Add a photo of <em>each</em> page <strong>in order</strong>. Use ↑ ↓ to reorder. We turn them into one PDF and submit it.
          </p>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple onChange={(e) => addFiles(e.target.files)} style={{ marginBottom: 10 }} />
          {pics.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {pics.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-soft)", borderRadius: 8, padding: "6px 10px" }}>
                  <span style={{ fontWeight: 700, minWidth: 22 }}>{i + 1}.</span>
                  <span style={{ flex: 1, fontSize: ".82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name || `Page ${i + 1}`}</span>
                  <button className="btn small secondary" type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button className="btn small secondary" type="button" onClick={() => move(i, 1)} disabled={i === pics.length - 1} aria-label="Move down">↓</button>
                  <button className="btn small secondary" type="button" onClick={() => removeAt(i)} aria-label="Remove">✕</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn block" type="button" disabled={busy} onClick={submit}>
            {busy ? "Please wait…" : `Make PDF & submit (${pics.length} page${pics.length === 1 ? "" : "s"})`}
          </button>
          {note && <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>{note}</p>}
        </div>
      </div>
    );
  }

  // ===== NOT STARTED — instructions + start =====
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ border: "2px solid var(--accent)" }}>
        <h3 style={{ marginTop: 0 }}>📝 {title}</h3>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontWeight: 700, margin: "6px 0 10px" }}>
          <span>⏱️ Time: {durationMinutes} min to solve + 10 min to upload = {totalAllowed} min total</span>
          {totalMarks > 0 && <span>🏆 {totalMarks} marks</span>}
        </div>
        <ol style={{ margin: "0 0 0 18px", padding: 0, display: "grid", gap: 6, fontSize: ".92rem" }}>
          <li>Tap <strong>Start &amp; download question paper</strong> — your timer of <strong>{totalAllowed} minutes</strong> begins the moment you start.</li>
          <li>Solve the paper on physical paper within <strong>{durationMinutes} minutes</strong>.</li>
          <li>Photograph <strong>each answer page in order</strong>, add them here (you can reorder), and we&apos;ll combine them into one PDF.</li>
          <li>Upload before the timer ends. You get the extra 10 minutes only for photographing &amp; uploading.</li>
          <li>After you submit, we check your handwriting against the official solution and show your <strong>marks + where to improve</strong>.</li>
        </ol>
        {instructions && <p style={{ marginTop: 10, whiteSpace: "pre-wrap" }}><strong>Note from CA Parveen Sharma:</strong> {instructions}</p>}
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>⚠️ You get <strong>one attempt</strong>. The timer cannot be paused or restarted once you begin. If you don&apos;t upload within {totalAllowed} minutes, the upload closes.</p>
        <button className="btn block" type="button" disabled={busy || !questionPdf} onClick={start} style={{ marginTop: 12 }}>
          {busy ? "Starting…" : "▶️ Start & download question paper"}
        </button>
        {!questionPdf && <p className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>The question paper isn&apos;t uploaded yet — please check back soon.</p>}
      </div>

      {/* Trial — practise the upload with no timer, no marks */}
      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>🧪 First time? Practise the upload (optional, not graded)</summary>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
          Take 2–3 photos of anything, then tap the button — we&apos;ll make a PDF and upload it, just so you know it works on your device before the real test. This is <strong>not</strong> your paper and isn&apos;t graded.
        </p>
        <input ref={trialRef} type="file" accept="image/*" capture="environment" multiple onChange={(e) => setTrialPics(Array.from(e.target.files ?? []))} style={{ marginBottom: 8 }} />
        <button className="btn small" type="button" onClick={tryUpload}>Try a test upload</button>
        {trialMsg && <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>{trialMsg}</p>}
      </details>
    </div>
  );
}
