"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startPaperAttempt, submitPaperAttempt, gradePaperNow, resetMyPaperAttempt, rebuildCheckedCopy, type PaperAttempt } from "./paperActions";
import { viaProxy } from "@/lib/fileProxy";
import AnswerKey from "@/app/components/AnswerKey";

type Props = {
  sectionId: string;
  studentId: string;
  title: string;
  questionPdf: string;
  solutionPdf: string;
  /** The approved typeset answer key, shown once a paper has been submitted. */
  officialKey?: string;
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



// SAY WHAT ACTUALLY WENT WRONG.
//
// This used to return null on any failure, and the screen said "Upload failed —
// please check your connection". So when a student could not submit, there was
// nothing to go on: no error in the browser, none on the server, and no file in
// the bucket to prove they had tried. Diagnosing one upload took most of an
// evening, with the student sitting there and his marked paper in front of him.
//
// The reason now comes back with the failure. The student sees a sentence they
// can act on, and it is written to the console so it can be read out over the
// phone. Storage refusals are usually one of three things — an expired login,
// a file the bucket will not take, or the network — and they need different
// answers, so guessing between them helps nobody.
type UploadResult = { url: string } | { error: string };

async function uploadPdf(blob: Blob, path: string): Promise<UploadResult> {
  const supabase = createClient();

  // An expired login is the failure that looks most like a broken upload: the
  // page still works, the file is chosen, and storage answers 401. Checked
  // first so it can be named rather than reported as a connection problem.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { error: "Your login has expired. Open the site again and sign in, then come back — your test is still open and nothing is lost." };
  }

  // Answer sheets are personal — upload to the PRIVATE "secure" bucket and
  // store a "secure:<path>" reference (served only via signed URLs, never a
  // public link).
  const { error } = await supabase.storage.from("secure").upload(path, blob, { contentType: "application/pdf", upsert: true });
  if (error) {
    const detail = String(error.message ?? error);
    console.error("[paper-upload] refused:", detail, "path:", path);
    if (/jwt|expired|401|unauthor/i.test(detail)) {
      return { error: "Your login expired while you were writing. Sign in again and come straight back — your test is still open." };
    }
    if (/exceed|too large|size|413/i.test(detail)) {
      return { error: "That PDF is too large to send. Scan it again in black and white, or at a lower quality, and try once more." };
    }
    // Anything else, verbatim. An unfamiliar message somebody can read out is
    // worth ten guesses.
    return { error: `The upload was refused: ${detail}` };
  }
  return { url: `secure:${path}` };
}

// Help for a student stuck at the upload — written for someone on a phone,
// under exam time pressure, who has never scanned anything before. It sits
// beside the upload rather than on a help page, because that is where the
// question is actually asked.
function UploadHelp() {
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="btn as-btn small secondary" style={{ cursor: "pointer" }}>
        ❓ Need help uploading? Read this
      </summary>
      <div style={{ fontSize: ".85rem", lineHeight: 1.65, marginTop: 10 }}>
        <p style={{ margin: "0 0 10px" }}>
          <strong>Answers are accepted as ONE PDF only.</strong> Loose photographs are not accepted — your phone
          can scan straight to PDF, and it takes a minute.
        </p>
        <p style={{ margin: "0 0 6px", fontWeight: 700 }}>Making a PDF on your phone</p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          <li>
            <strong>iPhone:</strong> open <em>Notes</em>, make a new note, tap the camera icon and choose
            <em> Scan Documents</em>. Capture every page one after another, tap <em>Save</em>, then share it as a PDF.
          </li>
          <li>
            <strong>Android:</strong> open <em>Google Drive</em>, tap <em>+</em> then <em>Scan</em>. Capture
            each page, add the next with <em>+</em>, then save — Drive stores it as one PDF.
          </li>
          <li>
            Both apps make ONE PDF from many pages — add every page to the same scan, in order, before you save.
          </li>
        </ul>

        <p style={{ margin: "0 0 6px", fontWeight: 700 }}>Scans that can actually be marked</p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          <li>Lay the page flat in good light — daylight near a window is best.</li>
          <li>Hold the phone straight above the page, not at an angle.</li>
          <li>Get all four corners in the frame, including the question numbers.</li>
          <li>One page per scan, added <strong>in order</strong> — check the order before you save the PDF.</li>
          <li>Check every page is sharp before you save the PDF. Blurred handwriting cannot be marked, and you
            get one attempt.</li>
        </ul>

        <p style={{ margin: "0 0 6px", fontWeight: 700 }}>If something goes wrong</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Your file will not select:</strong> it must be a real <code>.pdf</code>. A photo, a Word file
            or a screenshot will not do — scan it into a PDF first.</li>
          <li><strong>&ldquo;Over 20 MB&rdquo;:</strong> scan in black and white, or at a lower quality, and try
            again.</li>
          <li><strong>Upload fails or sticks:</strong> check your internet and press submit again. Nothing is
            lost, and your pages stay listed here.</li>
          <li><strong>Time runs out while you are uploading:</strong> you have 10 extra minutes after the
            solving time for exactly this. Start uploading before the clock turns red.</li>
          <li>Still stuck? Send your pages to the faculty on WhatsApp from your subject page and say which
            test it is — your attempt will not be lost.</li>
        </ul>
      </div>
    </details>
  );
}

export default function DescriptivePaper(props: Props) {
  const { sectionId, studentId, title, solutionPdf, officialKey, durationMinutes, totalMarks, instructions } = props;
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

  // ---- the uploader: ONE PDF, nothing else. Loose photographs were accepted
  // and stitched together, which produced crooked, half-readable books and a
  // step students did not need — every phone can scan straight to PDF.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  // How far the submission has got. The steps are known even though the upload
  // itself reports no byte-level progress, so the bar moves with real events
  // rather than pretending to a percentage nobody measured.
  const [progress, setProgress] = useState(0);
  const pdfRef = useRef<HTMLInputElement>(null);

  // PHOTOGRAPHS ARE ACCEPTED AGAIN, AND WE MAKE THE PDF.
  //
  // This took ONE PDF and refused everything else. The intention was good —
  // a phone scan is straighter and easier to mark than a handful of snaps — but
  // it left a student who had photographed his pages with no way in at all, and
  // "accept=application/pdf" makes most Android galleries offer him nothing to
  // pick. He is then staring at a file chooser that appears broken, with a
  // clock running, having already written the paper.
  //
  // So the scan is still what we ask for, and photographs are stitched into a
  // single PDF here rather than turned away. The same thing the repository
  // uploader has always done. A crooked page can be marked; an unsubmitted
  // paper cannot.
  const [photos, setPhotos] = useState<File[]>([]);

  const choosePdf = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;

    const pdf = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdf) {
      if (pdf.size > 20 * 1024 * 1024) {
        setNote("That PDF is over 20 MB. Please scan it again in black and white, or at a lower quality.");
        if (pdfRef.current) pdfRef.current.value = "";
        return;
      }
      setPdfFile(pdf); setPhotos([]); setNote(null);
      return;
    }

    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      setNote(`"${files[0].name}" is neither a PDF nor a photograph. Choose your scanned PDF, or photographs of your pages.`);
      if (pdfRef.current) pdfRef.current.value = "";
      return;
    }
    // Pages come out in the order the phone lists them, which is not always the
    // order they were written in. Sorting by name puts IMG_001 before IMG_010,
    // and the student is told to check before submitting.
    images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setPhotos(images); setPdfFile(null);
    setNote(`${images.length} photograph${images.length === 1 ? "" : "s"} selected — check the order below before you submit.`);
  };

  /** Photographs → one PDF, a page each, shrunk enough to travel on a phone. */
  async function photosToPdf(files: File[]): Promise<Blob> {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    for (const f of files) {
      const img = document.createElement("img");
      const url = URL.createObjectURL(f);
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      // 1600px on the long edge keeps handwriting legible while keeping a
      // twelve-page answer book inside the 20 MB limit.
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const jpg: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.82)!);
      const em = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const page = doc.addPage([em.width, em.height]);
      page.drawImage(em, { x: 0, y: 0, width: em.width, height: em.height });
    }
    return new Blob([(await doc.save()) as BlobPart], { type: "application/pdf" });
  }

  async function submit() {
    if (!pdfFile && !photos.length) {
      setNote("Choose your answer PDF, or photographs of your pages.");
      return;
    }
    setBusy(true);
    setProgress(10);
    setNote(photos.length ? "Making one PDF from your photographs…" : "Preparing your file…");
    try {
      const blob: Blob = pdfFile ?? (await photosToPdf(photos));
      if (blob.size > 20 * 1024 * 1024) {
        setNote("Those pages come to more than 20 MB together. Please send fewer photographs, or scan them instead.");
        setBusy(false);
        return;
      }
      setProgress(35);
      setNote("Uploading your paper…");
      const up = await uploadPdf(blob, `descriptive/${sectionId}/${studentId}-${Date.now()}.pdf`);
      if ("error" in up) {
        setNote(up.error);
        setBusy(false);
        return;
      }
      const url = up.url;
      setProgress(75);
      setNote("Submitting your paper…");
      const r = await submitPaperAttempt({ sectionId, fileUrl: url });
      setProgress(100);
      setAttempt(r);
      setPdfFile(null);
      setPhotos([]);
      setNote(null);
    } catch {
      setNote("Something went wrong while sending your PDF. Please try again.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  // ---- trial upload (practice) ----
  const [trialMsg, setTrialMsg] = useState<string | null>(null);
  const [trialPdf, setTrialPdf] = useState<File | null>(null);
  const trialRef = useRef<HTMLInputElement>(null);
  async function tryUpload() {
    if (!trialPdf) {
      setTrialMsg("Choose any PDF to test the upload.");
      return;
    }
    setTrialMsg("Uploading a test PDF…");
    try {
      const up = await uploadPdf(trialPdf, `descriptive/trial/${studentId}-${Date.now()}.pdf`);
      setTrialMsg("error" in up
        ? up.error
        : "✅ It works! Your device can send a PDF to us. You're ready for the real test.");
    } catch {
      setTrialMsg("That file could not be uploaded — make sure it is a PDF.");
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
          {attempt.annotatedUrl && (
            <p className="muted" style={{ fontSize: ".85rem", margin: "10px 0 0" }}>
              One file, three things: the marking written on your own pages — ✓ where you earned marks, ✗ where you
              lost them, and a note beside each — then a summary sheet, and then the <strong>official answers</strong>
              {" "}in full at the end. Read the summary first, then compare your working against the official answers.
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {attempt.annotatedUrl && <a className="btn" href={fileHref(attempt.annotatedUrl, "My checked copy and the official answers")} target={fileTarget} rel="noopener noreferrer">📝 Open my checked copy + official answers</a>}
            {attempt.fileUrl && <a className="btn small secondary" href={fileHref(attempt.fileUrl, "My uploaded answers")} target={fileTarget} rel="noopener noreferrer">📄 My uploaded answers</a>}
            {questionPdf && <a className="btn small secondary" href={fileHref(questionPdf, "Question paper")} target={fileTarget} rel="noopener noreferrer">📄 Question paper</a>}
            {solutionPdf && <a className="btn small secondary" href={fileHref(solutionPdf, "Official solution")} target={fileTarget} rel="noopener noreferrer">✅ Official solution (PDF)</a>}
            {props.isAdmin && (
              <>
                {!attempt.annotatedUrl && (
                  <button className="btn small secondary" type="button" disabled={busy}
                    onClick={async () => { setBusy(true); try { setAttempt(await rebuildCheckedCopy(sectionId)); } finally { setBusy(false); } }}>
                    🖍️ Rebuild my checked copy
                  </button>
                )}
                <button className="btn small secondary" type="button" disabled={busy} onClick={async () => { setBusy(true); try { setAttempt(await resetMyPaperAttempt(sectionId)); } finally { setBusy(false); } }}>
                  🔄 Reset (admin preview)
                </button>
              </>
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

        {r.improvements.length > 0 && !attempt.annotatedUrl && (
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
          <p className="muted">
            🧑‍🏫 Our AI has evaluated your copy and it has now gone to the faculty for a second round of
            checking. <strong>Your marks are not shown until the faculty has reviewed them.</strong> Papers are
            generally returned within about two hours. You will see your checked copy here as soon as it is
            released, and we will email you.
          </p>
        ) : (
          <p className="muted">
            🧑‍🏫 <strong>Your copy is under review.</strong> Our AI checks it against the official solution — that
            takes a few minutes — and it then goes to the faculty for a second round of checking. Papers are
            generally returned within about two hours, and we will email you when yours is ready.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {/* No "show my result" for the student: the result is not theirs to
              pull until the faculty has released it. Kept for admins only, as
              a way to force a re-check while testing. */}
          {props.isAdmin && !attempt.underReview && (
            <button className="btn small secondary" type="button" disabled={busy} onClick={regrade}>
              {busy ? "Checking…" : "🔄 Re-check now (admin)"}
            </button>
          )}
          {questionPdf && <a className="btn small secondary" href={fileHref(questionPdf, "Question paper")} target={fileTarget} rel="noopener noreferrer">📄 Question paper</a>}
          {attempt.fileUrl && <a className="btn small secondary" href={fileHref(attempt.fileUrl, "My uploaded answers")} target={fileTarget} rel="noopener noreferrer">📄 My submission (unchecked)</a>}
          {solutionPdf && <a className="btn small secondary" href={fileHref(solutionPdf, "Official solution")} target={fileTarget} rel="noopener noreferrer">✅ Official solution (PDF)</a>}
          {/* An admin previewing a paper was stranded here: once it went to the
              examiner desk there was no way back to take it again. */}
          {props.isAdmin && (
            <>
              <button className="btn small secondary" type="button" disabled={busy}
                onClick={async () => { setBusy(true); try { setAttempt(await rebuildCheckedCopy(sectionId)); } finally { setBusy(false); } }}>
                🖍️ Rebuild my checked copy
              </button>
              <button className="btn small secondary" type="button" disabled={busy}
                onClick={async () => { setBusy(true); try { setAttempt(await resetMyPaperAttempt(sectionId)); } finally { setBusy(false); } }}>
                🔄 Reset (admin preview)
              </button>
            </>
          )}
        </div>

        {officialKey && (
          <details className="card" style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>✅ Official solution — read it while you wait</summary>
            <AnswerKey text={officialKey} size=".82rem" />
          </details>
        )}
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
          <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 8px" }}>Solve it on paper, then scan your pages into one PDF.</p>
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
            Upload your answers as one PDF, with the pages in order.
          </p>

          <div style={{ background: "var(--bg-soft)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
            <strong style={{ fontSize: ".9rem" }}>📄 Your answers — a PDF, or photographs of your pages</strong>
            <p className="muted" style={{ fontSize: ".8rem", margin: "2px 0 8px" }}>
              Best is a single scanned PDF with the pages in order. If you only have photographs of your pages,
              choose them all together and we will make the PDF for you.
            </p>
            <input
              ref={pdfRef}
              type="file"
              // Photographs allowed as well as a PDF, and MULTIPLE — an
              // "application/pdf" filter leaves most Android galleries with
              // nothing to offer, which is a file chooser that looks broken.
              accept="application/pdf,.pdf,image/*"
              multiple
              onChange={(e) => choosePdf(e.target.files)}
              disabled={busy}
            />
            {photos.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ fontSize: ".8rem", margin: "0 0 4px" }}>
                  These become one PDF, in this order — check it reads 1, 2, 3 before you submit:
                </p>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: ".8rem" }}>
                  {photos.map((f, i) => <li key={i}>{f.name}</li>)}
                </ol>
                <button className="btn small secondary" type="button" style={{ marginTop: 6 }}
                  onClick={() => { setPhotos([]); if (pdfRef.current) pdfRef.current.value = ""; }}>
                  ✕ Clear and choose again
                </button>
              </div>
            )}
            {pdfFile && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <span style={{ flex: 1, fontSize: ".82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  📄 {pdfFile.name} ({(pdfFile.size / 1048576).toFixed(1)} MB)
                </span>
                <button
                  className="btn small secondary"
                  type="button"
                  onClick={() => { setPdfFile(null); if (pdfRef.current) pdfRef.current.value = ""; }}
                >
                  ✕ Remove
                </button>
              </div>
            )}
          </div>

          <button className="btn block" type="button" disabled={busy} onClick={submit}>
            {busy ? "Please wait…" : "Submit my PDF"}
          </button>
          {busy && (
            <div style={{ marginTop: 12 }} aria-live="polite">
              <div style={{ height: 8, borderRadius: 999, background: "var(--bg-soft)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(8, progress)}%`,
                    borderRadius: 999,
                    background: "var(--accent)",
                    transition: "width .5s ease",
                  }}
                />
              </div>
              <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>
                {note ?? "Working…"} Please keep this page open until it finishes.
              </p>
            </div>
          )}
          {!busy && note && <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>{note}</p>}
          <UploadHelp />
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
          <li>Scan your answer pages into <strong>one PDF, in order</strong>, and upload it. Your phone can do this — see &ldquo;How to send your answers&rdquo; below.</li>
          <li>Upload before the timer ends. You get the extra 10 minutes only for scanning &amp; uploading.</li>
          <li>After you submit, we check your handwriting against the official solution and show your <strong>marks + where to improve</strong>.</li>
        </ol>
        {instructions && <p style={{ marginTop: 10, whiteSpace: "pre-wrap" }}><strong>Note from CA Parveen Sharma:</strong> {instructions}</p>}
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>⚠️ You get <strong>one attempt</strong>. The timer cannot be paused or restarted once you begin. If you don&apos;t upload within {totalAllowed} minutes, the upload closes.</p>
        <button className="btn block" type="button" disabled={busy || !questionPdf} onClick={start} style={{ marginTop: 12 }}>
          {busy ? "Starting…" : "▶️ Start & download question paper"}
        </button>
        {!questionPdf && <p className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>The question paper isn&apos;t uploaded yet — please check back soon.</p>}
      </div>

      {/* The same help as on the upload step. Better read now, in the student's
          own time, than discovered with the clock running. */}
      <div className="card">
        <strong>📤 How to send your answers</strong>
        <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 0" }}>
          Worth two minutes now — scanning for the first time with the timer running is nobody&apos;s idea of fun.
        </p>
        <UploadHelp />
      </div>

      {/* Trial — practise the upload with no timer, no marks */}
      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>🧪 First time? Practise the upload (optional, not graded)</summary>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
          Scan or pick any PDF and tap the button, just so you know the upload works on your device before the real test. This is <strong>not</strong> your paper and isn&apos;t graded.
        </p>
        <input ref={trialRef} type="file" accept="application/pdf,.pdf" onChange={(e) => setTrialPdf(e.target.files?.[0] ?? null)} style={{ marginBottom: 8 }} />
        <button className="btn small" type="button" onClick={tryUpload}>Try a test upload</button>
        {trialMsg && <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>{trialMsg}</p>}
      </details>
    </div>
  );
}
