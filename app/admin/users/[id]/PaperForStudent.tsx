"use client";

import { useState } from "react";
import { ANSWER_ACCEPT, sortChosenDeep, photosToPdf, shrinkPdf, uploadAnswerPdf } from "@/lib/answerUpload";
import { submitPaperForStudent } from "../actions";

type Test = { id: string; title: string; subject: string };
type Mock = { id: string; title: string };

// UPLOAD A PAPER FOR A STUDENT WHO CANNOT UPLOAD IT THEMSELVES.
//
// The file goes up from THIS browser — a desk, a real connection — and the
// student's attempt is created against the same answer key an ordinary
// submission uses. Nothing about the marking differs.
//
// No failure reporting here on purpose: reportFailure exists to count students
// who cannot send papers, and an admin's upload is not that. Adding it would put
// staff activity into a report built to find struggling students.
export default function PaperForStudent({
  studentId, studentName, tests, mocks,
}: { studentId: string; studentName: string; tests: Test[]; mocks: Mock[] }) {
  const [fileUrl, setFileUrl] = useState("");
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState("");
  const [chosenName, setChosenName] = useState("");

  const groups = new Map<string, Test[]>();
  for (const t of tests) {
    if (!groups.has(t.subject)) groups.set(t.subject, []);
    groups.get(t.subject)!.push(t);
  }

  async function choose(files: File[]) {
    setError(null); setBusy(true); setFileUrl("");
    try {
      const { pdf, photos, rejected } = await sortChosenDeep(files);
      if (rejected) {
        setError(`That file could not be read as a PDF or photographs: ${rejected}`);
        return;
      }
      setChosenName(pdf?.name ?? `${photos.length} photographs`);
      setStage(photos.length ? `Making one PDF from ${photos.length} photographs…` : "Preparing the file…");
      let blob: Blob = pdf ?? (await photosToPdf(photos));
      blob = await shrinkPdf(blob, setStage, "paper_check");
      setStage(`Uploading (${(blob.size / 1048576).toFixed(1)} MB)…`);
      const up = await uploadAnswerPdf(
        blob,
        `paper-check/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
        setStage,
      );
      if ("error" in up) { setError(up.error); setStage(""); return; }
      setFileUrl(up.url);
      setStage("Uploaded ✓ — now press Submit for marking");
    } catch (e) {
      setError(`Could not prepare that file: ${(e as Error).message}`);
      setStage("");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("student_id", studentId);
    fd.set("paper", paper);
    fd.set("file_url", fileUrl);
    const r = await submitPaperForStudent(fd);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Could not submit it."); return; }
    setDone(true); setStage(""); setFileUrl("");
  }

  if (done) {
    return (
      <div className="notice ok" style={{ marginTop: 10, fontSize: ".9rem", lineHeight: 1.7 }}>
        ✅ Submitted for {studentName}. It is being marked against Sir&apos;s answer key now and will appear on the{" "}
        <a href="/examiner">examiner desk</a> for release. The student will see it under &ldquo;My checked
        copies&rdquo; once an examiner releases it.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      <div>
        <label style={{ fontWeight: 600, fontSize: ".85rem" }}>Which paper is this?</label>
        <select value={paper} onChange={(e) => setPaper(e.target.value)} disabled={busy}>
          <option value="">Choose…</option>
          {mocks.length > 0 && (
            <optgroup label="Mock test papers">
              {mocks.map((m) => <option key={m.id} value={`mock:${m.id}`}>{m.title}</option>)}
            </optgroup>
          )}
          {[...groups.entries()].map(([subject, items]) => (
            <optgroup key={subject} label={subject}>
              {items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0" }}>
          It must be the right one — the paper is marked against that paper&apos;s own approved key.
        </p>
      </div>

      <div>
        <label style={{ fontWeight: 600, fontSize: ".85rem" }}>Their answer book — a PDF, or photographs</label>
        <input
          type="file"
          accept={ANSWER_ACCEPT}
          multiple
          disabled={busy}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            if (list.length) choose(list);
          }}
        />
        {chosenName && <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>{chosenName}</p>}
        {stage && <p style={{ fontSize: ".85rem", fontWeight: 700, margin: "4px 0 0" }}>{stage}</p>}
        {error && <p className="notice err" style={{ fontSize: ".85rem", marginTop: 6 }}>{error}</p>}
      </div>

      <button className="btn" type="button" disabled={busy || !fileUrl || !paper} onClick={submit}>
        📤 Submit for marking
      </button>
    </div>
  );
}
