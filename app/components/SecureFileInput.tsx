"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Upload one file (image/PDF) to the PRIVATE "secure" bucket and expose its
// "secure:<path>" reference via a hidden input, so a server-action form picks it
// up. Requires the user to be logged in (secure bucket allows authenticated
// uploads only).
export default function SecureFileInput({
  name, label, accept = "image/*,application/pdf", folder = "uploads", required = false,
}: { name: string; label: string; accept?: string; folder?: string; required?: boolean }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const supabase = createClient();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 6);
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("secure").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: true });
      if (error) { alert("Upload failed — please try again."); return; }
      setRef(`secure:${path}`); setFileName(file.name);
    } finally { setBusy(false); e.target.value = ""; }
  }

  return (
    <div>
      <label>{label}{required ? " *" : ""}</label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn small secondary" style={{ cursor: "pointer", margin: 0 }}>
          {busy ? "Uploading…" : ref ? "Replace file" : "Choose file"}
          <input type="file" accept={accept} onChange={onFile} style={{ display: "none" }} disabled={busy} />
        </label>
        {fileName && <span className="muted" style={{ fontSize: ".82rem" }}>{ref ? "✓ " : ""}{fileName}</span>}
      </div>
      <input type="hidden" name={name} value={ref} required={required} />
    </div>
  );
}
