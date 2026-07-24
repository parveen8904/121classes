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

  // Photos straight off a camera are 3-8 MB PNGs/JPEGs — far bigger than any
  // screen needs. Downscale to max 1920px and re-encode as JPEG (q0.85) before
  // uploading, so the stored original is already light (~100-400 KB).
  async function shrink(file: File): Promise<{ blob: Blob; ext: string; ct: string }> {
    const asIs = { blob: file as Blob, ext: (file.name.split(".").pop() || "jpg").toLowerCase(), ct: file.type || "image/jpeg" };
    if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return asIs;
    if (file.size < 300 * 1024) return asIs; // already small
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, 1920 / Math.max(img.width || 1920, img.height || 1920));
      const w = Math.max(1, Math.round((img.width || 1920) * scale));
      const h = Math.max(1, Math.round((img.height || 1920) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return asIs;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (blob && blob.size < file.size) return { blob, ext: "jpg", ct: "image/jpeg" };
      return asIs;
    } catch { return asIs; }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      // Renew a stale auth token first (a long-open page otherwise hangs on
      // "uploading…" until refreshed) and cap the wait at 2 minutes.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session || (sess.session.expires_at ?? 0) * 1000 < Date.now() + 30_000) {
        await supabase.auth.refreshSession();
      }
      const { blob, ext, ct } = await shrink(file);
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await Promise.race([
        supabase.storage.from("media").upload(path, blob, { upsert: false, contentType: ct }),
        new Promise<{ error: Error }>((res) => setTimeout(() => res({ error: new Error("Upload took too long — please check your internet and try again (no refresh needed).") }), 120_000)),
      ]);
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
