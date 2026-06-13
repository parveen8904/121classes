"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Upload an image to the public "media" bucket and keep its URL in a named
// field (so the surrounding server-action form posts it). Also accepts a
// pasted URL. Shows a live preview.
export default function ImageUpload({
  name,
  defaultValue = "",
  folder = "misc",
  label = "Image",
}: {
  name: string;
  defaultValue?: string;
  folder?: string;
  label?: string;
}) {
  const [url, setUrl] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) {
        alert("Upload failed: " + error.message);
        return;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setUrl(data.publicUrl);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <label>{label}</label>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="preview"
            style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }}
          />
        ) : (
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 10,
              border: "1px dashed var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.4rem",
            }}
          >
            🖼️
          </div>
        )}
        <label className="btn small secondary" style={{ cursor: "pointer", margin: 0 }}>
          {busy ? "Uploading…" : url ? "Change photo" : "Upload photo"}
          <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} disabled={busy} />
        </label>
        {url && (
          <button type="button" className="btn small secondary" onClick={() => setUrl("")}>
            Remove
          </button>
        )}
      </div>
      <input
        name={name}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="…or paste an image URL"
      />
    </div>
  );
}
