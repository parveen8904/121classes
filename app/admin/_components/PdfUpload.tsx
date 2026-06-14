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
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
      const { error } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, contentType: file.type || "application/pdf" });
      if (error) {
        alert("Upload failed: " + error.message);
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
