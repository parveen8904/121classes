"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Upload a PDF and keep its reference in a named field (so the surrounding
// server-action form posts it). Also accepts a pasted URL.
//
// Uploads go to the PRIVATE "secure" bucket and are stored as "secure:<path>".
// They used to go to the public bucket, which meant every newly uploaded note,
// paper or answer key was downloadable by anyone holding the link — quietly
// undoing the migration that moved the paid material out of public view.
export default function PdfUpload({
  name,
  defaultValue = "",
  folder = "materials",
  label = "PDF",
}: {
  name: string;
  defaultValue?: string;
  folder?: string;
  label?: string;
}) {
  const [url, setUrl] = useState(defaultValue);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Some PDFs reach the browser with no media type at all (or an odd one),
    // and an accept="application/pdf" filter then greys them out in the file
    // dialog so they cannot even be chosen. Anything can be picked; the check
    // happens here, where the reason can actually be explained.
    const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!looksPdf) {
      alert(`"${file.name}" is not a PDF. Please choose a .pdf file, or paste a link to one in the box below.`);
      e.target.value = "";
      return;
    }
    setBusy(true);
    try {
      // A page left open for a while holds an EXPIRED auth token — uploads then
      // hang on "uploading…" forever until a refresh. Renew the session first,
      // and never wait more than 2 minutes without telling the user.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session || (sess.session.expires_at ?? 0) * 1000 < Date.now() + 30_000) {
        await supabase.auth.refreshSession();
      }
      const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Upload took too long — please check your internet and try again (no refresh needed).")), 120_000)),
        ]);

      const ct = file.type || "application/pdf";
      const MB = file.size / (1024 * 1024);

      // Small PDFs (notes, materials) go to Supabase Storage directly — fast and
      // reliable. Only big files (e.g. full books) use Cloudflare R2.
      if (MB <= 50) {
        const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
        const { error } = await withTimeout(supabase.storage.from("secure").upload(path, file, { upsert: false, contentType: ct }));
        if (error) { alert("Upload failed: " + error.message); return; }
        setUrl(`secure:${path}`);
        setFileName(file.name);
        return;
      }

      // Large file → R2 presigned PUT (needs R2 configured + CORS on the bucket).
      const res = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, ext: "pdf", contentType: ct }),
      });
      const dest = await res.json();
      if (dest.provider === "r2" && dest.uploadUrl) {
        const put = await fetch(dest.uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
        if (!put.ok) { alert(`Upload failed (R2): ${put.status}. For this ${MB.toFixed(0)} MB file, R2 must be set up with CORS for this site.`); return; }
        setUrl(dest.publicUrl);
        setFileName(file.name);
        return;
      }
      alert(`This PDF is ${MB.toFixed(0)} MB — too big for Supabase (50 MB limit). Enable Cloudflare R2 for large files, or compress/split the PDF.`);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <label>{label}</label>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: "1.6rem" }}>{url ? "📄" : "➕"}</span>
        <label className="btn small secondary" style={{ cursor: "pointer", margin: 0 }}>
          {busy ? "Uploading…" : url ? "Replace PDF" : "Upload PDF"}
          <input type="file" onChange={onFile} style={{ display: "none" }} disabled={busy} />
        </label>
        {url && (
          <>
            <a
              className="btn small secondary"
              href={url.startsWith("secure:") ? `/api/file?u=${encodeURIComponent(url)}` : url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View
            </a>
            <button type="button" className="btn small secondary" onClick={() => { setUrl(""); setFileName(""); }}>
              Remove
            </button>
          </>
        )}
        {fileName && <span className="muted" style={{ fontSize: ".82rem" }}>{fileName}</span>}
      </div>
      <input
        name={name}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="…or paste a PDF URL"
      />
    </div>
  );
}
