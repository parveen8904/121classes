"use client";

import { useState } from "react";
import SubmitButton from "@/app/components/SubmitButton";
import { uploadStatementAction } from "./actions";

// ONE BOX, WHATEVER THEY HAVE.
//
// His point, 2 September 2026: "Just like you are checking the student paper,
// which is so bad handwriting — you should put one method where you can upload
// the document. You should go to the next step."
//
// The comparison is the argument. The paper checker has been reading appalling
// handwriting off a phone camera for months, and it asks the student nothing:
// pick your pages, it works out the rest. The statement upload had grown the
// opposite way — five accepted extensions, a password box on every upload, and
// a failure that told the desk to go and find a different file.
//
// So: Excel, CSV, PDF, or photographs of the pages. Several photographs become
// one PDF here, in the browser, exactly as the answer-sheet upload does — a
// statement runs to more than one page and nobody should have to upload them
// one at a time. The password stays, folded away, because it is needed
// occasionally and asked for always was noise.
export default function StatementUpload({ accounts }: { accounts: string[] }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  async function onSubmit(fd: FormData) {
    const picked = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    const photos = picked.filter((f) => f.type.startsWith("image/"));

    // More than one photograph → one PDF, in filename order so page 2 lands
    // before page 10 rather than in whatever order the picker handed them over.
    if (photos.length > 1 && photos.length === picked.length) {
      setBusy("Putting the photographs together…");
      try {
        const { photosToPdf, sortChosenDeep } = await import("@/lib/answerUpload");
        const sorted = (await sortChosenDeep(photos)).photos;
        let pdf: Blob = await photosToPdf(sorted.length ? sorted : photos);
        // Phone photographs are several megabytes each and a server action
        // takes 8MB in total, so the joined file is shrunk the same way the
        // answer-sheet upload shrinks a scanned paper.
        if (pdf.size > 6_000_000) {
          try {
            const { shrinkPdf } = await import("@/lib/answerUpload");
            pdf = await shrinkPdf(pdf, (m) => setBusy(m));
          } catch { /* the original still goes, and may still fit */ }
        }
        fd.delete("file");
        fd.append("file", new File([pdf], "statement-pages.pdf", { type: "application/pdf" }));
      } catch {
        setNote("Those photographs could not be joined — uploading the first one on its own.");
        fd.delete("file");
        fd.append("file", photos[0]);
      }
    } else if (picked.length > 1) {
      // A mixed pick, or several PDFs: take the first and say so, rather than
      // silently ignoring the rest.
      setNote(`Uploading ${picked[0].name}. Upload the others one at a time — or pick photographs only, and they become one file.`);
      fd.delete("file");
      fd.append("file", picked[0]);
    }

    setBusy("Reading it…");
    try { await uploadStatementAction(fd); } finally { setBusy(""); }
  }

  return (
    <form action={onSubmit} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ minWidth: 240 }}>
        <label style={{ fontSize: ".75rem" }}>Account</label>
        <select name="account_name" required style={{ marginBottom: 0 }}>
          <option value="">— pick the bank / card —</option>
          {accounts.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, minWidth: 250 }}>
        <label style={{ fontSize: ".75rem" }}>The statement — however you have it</label>
        <input type="file" name="file" required multiple accept=".csv,.txt,.xls,.xlsx,.pdf,image/*" style={{ marginBottom: 0 }} />
        <p className="muted" style={{ fontSize: ".72rem", margin: "3px 0 0" }}>
          Excel, CSV, PDF, or photographs of the pages — several photos become one file. It works out the rest.
        </p>
      </div>

      <details>
        <summary className="btn small secondary as-btn" style={{ fontSize: ".78rem" }}>🔒 It has a password</summary>
        <input type="password" name="pdf_password" autoComplete="off" placeholder="Axis: usually name + date of birth"
          style={{ marginTop: 6, marginBottom: 0, width: 230 }} />
      </details>

      <SubmitButton className="btn small" savedLabel="✓ Read">📥 Upload &amp; read</SubmitButton>
      {busy && <span className="muted" style={{ fontSize: ".8rem" }}>{busy}</span>}
      {note && <span style={{ fontSize: ".8rem", color: "#b45309", flexBasis: "100%" }}>{note}</span>}
    </form>
  );
}
