"use client";

import { useState } from "react";
import { ANSWER_ACCEPT, sortChosenDeep, photosToPdf, shrinkPdf, uploadAnswerPdf, reportFailure } from "@/lib/answerUpload";
import { submitForChecking } from "./actions";

type Test = { id: string; title: string; course: string; subject: string };
type Mock = { id: string; title: string; course: string; paper_no: number };

// Upload straight to storage from the browser, then hand the server a reference.
//
// A scanned answer book is two to twenty megabytes; a server action tops out at
// eight, and a student on a phone should not discover that after waiting three
// minutes. So the file goes to the private bucket here, and only the reference
// travels through the form.
export default function PaperUpload({
  tests, mocks, name, level,
}: {
  tests: Test[]; mocks: Mock[]; name: string; level: string;
}) {
  // Which KIND of paper first. A student who has just sat mock paper 2 should
  // pick it from three, not hunt it in a list of seventy-two chapter tests —
  // and a student sending in a chapter test should never be shown the other
  // course's chapters at all.
  const [kind, setKind] = useState<"mock" | "test">(mocks.length ? "mock" : "test");
  // INTERMEDIATE UNLESS THEY SAY OTHERWISE.
  //
  // The rule for this page was always: be logged in, and we assume you are
  // sitting Intermediate. It was asking anyway — "Choose…" with nothing
  // selected and the field marked required — because it read study_level from
  // the profile, and that column is empty on every account on the system. So
  // every student, every visit, was made to answer a question we had already
  // decided the answer to.
  //
  // It stays changeable, because Final students exist. It is simply no longer
  // a gate in front of somebody who only wants their paper marked.
  const [studyLevel, setStudyLevel] = useState(level || "CA Intermediate");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState("");

  // Only their own course's tests, once we know which they are sitting.
  const mine = studyLevel ? tests.filter((t) => t.course === studyLevel) : tests;
  const myMocks = studyLevel ? mocks.filter((m) => m.course === studyLevel) : mocks;

  const groups = new Map<string, Test[]>();
  for (const t of mine) {
    const k = t.subject;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }

  // A PDF, OR PHOTOGRAPHS WE TURN INTO ONE.
  //
  // This page told students "loose photographs cannot be marked" and accepted
  // PDFs only — which on Android means the gallery offers nothing at all and
  // the chooser looks broken. A photographed answer book is now stitched into a
  // single PDF here, exactly as the timed test does.
  async function upload(files: File[]) {
    setError(null);
    // Believes the file's own bytes when the phone gives no type or extension.
    // Send stays disabled until a file is accepted, so refusing one here is a
    // dead end for the student — it must be both rare and recorded.
    const { pdf, photos, rejected } = await sortChosenDeep(files);
    if (rejected) {
      reportFailure("paper_check", `file not recognised: ${rejected}`);
      setError(
        "We could not read that as a PDF or a photograph. If you scanned it with a phone app, " +
        "export it as PDF and choose that file — or just photograph your pages and select them all together.",
      );
      return;
    }
    setBusy(true);
    try {
      setStage(photos.length ? `Making one PDF from ${photos.length} photographs…` : "Preparing your file…");
      let blob: Blob = pdf ?? (await photosToPdf(photos));
      // A scanner's PDF is far bigger than the handwriting on it needs.
      blob = await shrinkPdf(blob, setStage);
      if (blob.size > 25 * 1024 * 1024) {
        reportFailure("paper_check", `too big to send: ${(blob.size / 1048576).toFixed(1)} MB after shrinking`);
        setError("That comes to more than 25 MB. Scan it in black and white, or send fewer photographs.");
        setStage("");
        setBusy(false);
        return;
      }
      setStage(`Uploading your paper (${(blob.size / 1048576).toFixed(1)} MB)…`);
      const up = await uploadAnswerPdf(
        blob,
        `paper-check/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
        setStage,
      );
      if ("error" in up) {
        setError(up.error);
        setStage("");
        return;
      }
      setFileUrl(up.url);
      setStage("Uploaded ✓ — now press Send for checking");
    } catch (e) {
      // A file that cannot even be READ — a broken scan, a format the browser
      // will not decode, a phone that runs out of memory on twenty photographs.
      // The student is told, and now so are we; this is the failure that used to
      // vanish completely.
      reportFailure("paper_check", `could not prepare the file: ${(e as Error).message}`);
      setError("That file could not be prepared: " + (e as Error).message);
      setStage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submitForChecking} className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label>Your name</label>
          <input name="full_name" defaultValue={name} placeholder="As it should appear on the checked copy" required />
        </div>

        <div>
          <label>Which exam are you preparing for?</label>
          <select name="study_level" required value={studyLevel} onChange={(e) => setStudyLevel(e.target.value)}>
            <option value="CA Intermediate">CA Intermediate</option>
            <option value="CA Final">CA Final</option>
          </select>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
            Set to Intermediate. Change it if you are sitting Final.
          </p>
        </div>

        <div>
          <label>What are you sending?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {myMocks.length > 0 && (
              <button type="button" className={`btn small ${kind === "mock" ? "" : "secondary"}`} onClick={() => setKind("mock")}>
                📄 A mock test paper
              </button>
            )}
            <button type="button" className={`btn small ${kind === "test" ? "" : "secondary"}`} onClick={() => setKind("test")}>
              📚 A chapter test from the site
            </button>
          </div>
        </div>

        <div>
          <label>{kind === "mock" ? "Which mock paper?" : "Which chapter test?"}</label>
          <select name="paper" required defaultValue="" key={kind + studyLevel}>
            <option value="" disabled>Choose…</option>
            {kind === "mock"
              ? myMocks.map((m) => <option key={m.id} value={`mock:${m.id}`}>{m.title}</option>)
              : [...groups.entries()].map(([label, items]) => (
                  <optgroup key={label} label={label}>
                    {items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </optgroup>
                ))}
          </select>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
            This matters: your paper is marked against Sir&apos;s own answer key for that exact paper, so it has to be
            the right one.
          </p>
        </div>

        <div>
          <label>Your answer book — a PDF, or photographs of your pages</label>
          <input
            type="file"
            accept={ANSWER_ACCEPT}
            multiple
            disabled={busy}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              setFile(list[0] ?? null);
              if (list.length) upload(list);
            }}
          />
          <input type="hidden" name="file_url" value={fileUrl} />
          {file && <p className="muted" style={{ fontSize: ".82rem", marginTop: 4 }}>{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>}
          {stage && <p style={{ fontSize: ".85rem", marginTop: 4, fontWeight: 700 }}>{stage}</p>}
          {error && <p className="notice err" style={{ fontSize: ".85rem", marginTop: 6 }}>{error}</p>}
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>
            Best is one scanned PDF with the pages in order. If you only have photographs, choose them all together
            and we will make the PDF for you — check they are sharp enough to read.
          </p>
        </div>

        <button className="btn" type="submit" disabled={busy || !fileUrl}>
          📤 Send for checking
        </button>
      </div>
    </form>
  );
}
