"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const [studyLevel, setStudyLevel] = useState(level || "");
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

  async function upload(f: File) {
    setError(null);
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("It must be a PDF. Your phone can scan straight to PDF — iPhone Notes → Scan Documents, or Google Drive → + → Scan.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError("That file is over 25 MB. Scan it in black and white, or at a lower quality, and try again.");
      return;
    }
    setBusy(true);
    setStage("Uploading your paper…");
    try {
      const supabase = createClient();
      const path = `paper-check/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
      const { error: upErr } = await supabase.storage.from("secure").upload(path, f, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message);
      setFileUrl(`secure:${path}`);
      setStage("Uploaded ✓ — now press Send for checking");
    } catch (e) {
      setError("Upload failed: " + (e as Error).message + " — check your internet and try again.");
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
            <option value="" disabled>Choose…</option>
            <option value="CA Intermediate">CA Intermediate</option>
            <option value="CA Final">CA Final</option>
          </select>
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
          <label>Your answer book — one PDF</label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) upload(f);
            }}
          />
          <input type="hidden" name="file_url" value={fileUrl} />
          {file && <p className="muted" style={{ fontSize: ".82rem", marginTop: 4 }}>{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>}
          {stage && <p style={{ fontSize: ".85rem", marginTop: 4, fontWeight: 700 }}>{stage}</p>}
          {error && <p className="notice err" style={{ fontSize: ".85rem", marginTop: 6 }}>{error}</p>}
          <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>
            All pages in ONE PDF, in order, sharp enough to read. Loose photographs cannot be marked.
          </p>
        </div>

        <button className="btn" type="submit" disabled={busy || !fileUrl}>
          📤 Send for checking
        </button>
      </div>
    </form>
  );
}
