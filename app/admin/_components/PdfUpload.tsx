"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Upload a PDF to the public "media" bucket and keep its URL in a named field
// (so the surrounding server-action form posts it). Also accepts a pasted URL.
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
    setBusy(true);
    try {
      const ct = file.type || "application/pdf";
      const res = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, ext: "pdf", contentType: ct }),
      });
      const dest = await res.json();
      if (dest.provider === "r2" && dest.uploadUrl) {
        const put = await fetch(dest.uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
        if (!put.ok) { alert("Upload failed (R2): " + put.status); return; }
        setUrl(dest.publicUrl);
        setFileName(file.name);
        return;
      }
      // Supabase free-tier caps a single file at 50 MB. Big book PDFs need R2.
      const MB = file.size / (1024 * 1024);
      if (MB > 50) {
        alert(
          `This PDF is ${MB.toFixed(0)} MB. The current storage limit is 50 MB per file.\n\n` +
            `For large books, ask the admin to enable Cloudflare R2 (Integrations → it removes the size limit), or compress/split the PDF.`,
        );
        return;
      }
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
      const { error } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, contentType: ct });
      if (error) {
        const big = MB > 45;
        alert("Upload failed: " + error.message + (big ? `\n\n(This file is ${MB.toFixed(0)} MB — large PDFs need Cloudflare R2; ask admin to enable it.)` : ""));
        return;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setUrl(data.publicUrl);
      setFileName(file.name);
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
          <input type="file" accept="application/pdf,.pdf" onChange={onFile} style={{ display: "none" }} disabled={busy} />
        </label>
        {url && (
          <>
            <a className="btn small secondary" href={url} target="_blank" rel="noopener noreferrer">
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
