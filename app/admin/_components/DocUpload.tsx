"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// A PDF (or other document) to attach to a campaign — a brochure, notes, a
// hitlist. Unlike the video (which Meta posts as a Reel), a document goes out as
// a link appended to each post, so it works on WhatsApp, Telegram and email
// where a tap opens it. Uploaded to the public media bucket, same path as the
// campaign video, or pasted if it already lives somewhere public.
export default function DocUpload({
  name,
  defaultValue = "",
}: {
  name: string;
  defaultValue?: string;
}) {
  const [url, setUrl] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError("It needs to be a PDF file.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("That file is over 25 MB — please compress it or split it.");
      return;
    }
    setBusy(true);
    setStage("Uploading…");
    const contentType = file.type || "application/pdf";
    try {
      const res = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder: "campaign-doc", ext: "pdf", contentType }),
      });
      const plan = (await res.json()) as { provider?: string; uploadUrl?: string; publicUrl?: string };

      if (plan.provider === "r2" && plan.uploadUrl && plan.publicUrl) {
        const put = await fetch(plan.uploadUrl, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: file,
        });
        if (!put.ok) throw new Error(`R2 refused the upload (${put.status})`);
        setUrl(plan.publicUrl);
        setStage("Uploaded ✓");
      } else {
        const supabase = createClient();
        const path = `campaign-doc/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
        const { error: upErr } = await supabase.storage.from("media").upload(path, file, { contentType, upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { data } = supabase.storage.from("media").getPublicUrl(path);
        setUrl(data.publicUrl);
        setStage("Uploaded ✓");
      }
    } catch (e) {
      setError("Upload failed: " + (e as Error).message);
      setStage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <label>
        📄 PDF — attached to the post{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem" }}>
          goes out as a tappable link on WhatsApp, Telegram &amp; email
        </span>
      </label>
      <input type="hidden" name={name} value={url} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
        {url && (
          <button type="button" className="btn small secondary" onClick={() => { setUrl(""); setStage(""); }}>
            Remove
          </button>
        )}
      </div>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="…or paste a public PDF URL"
        style={{ marginTop: 6 }}
      />
      {stage && <p style={{ fontSize: ".82rem", marginTop: 4, fontWeight: 700 }}>{stage}</p>}
      {error && <p className="notice err" style={{ fontSize: ".82rem", marginTop: 6 }}>{error}</p>}
      {url && (
        <p style={{ marginTop: 8, fontSize: ".84rem" }}>
          <a href={url} target="_blank" rel="noopener noreferrer">📄 Open the uploaded PDF ↗</a>
        </p>
      )}
    </div>
  );
}
