"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The video a campaign goes out as — a Reel on Instagram, a Reel on Facebook,
// a Short on YouTube.
//
// It has to sit at a PUBLIC, directly-downloadable URL, because Meta and Google
// fetch the file from us rather than us pushing it to them. That rules out the
// two things one would reach for first: a Bunny class (HLS, not a file) and a
// YouTube link (a page, not a file). So it is uploaded to the public media
// bucket here, or pasted if it already lives somewhere public.
export default function VideoUpload({
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
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v)$/i.test(file.name)) {
      setError("It needs to be a video file — MP4 works everywhere.");
      return;
    }
    // Meta's own ceiling for a Reel by URL is around 1 GB, but a 200 MB upload
    // over Indian broadband is a bad afternoon. Reels are meant to be short.
    if (file.size > 200 * 1024 * 1024) {
      setError("That file is over 200 MB. A Reel should be well under a minute — export it smaller.");
      return;
    }
    setBusy(true);
    setStage("Uploading…");
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const path = `campaign-video/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
        contentType: file.type || "video/mp4",
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message);
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setUrl(data.publicUrl);
      setStage("Uploaded ✓");
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
        🎬 Video — posts as a Reel / Short{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem" }}>
          leave empty and Instagram gets the usual card instead
        </span>
      </label>
      <input type="hidden" name={name} value={url} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/*"
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
        placeholder="…or paste a public MP4 URL"
        style={{ marginTop: 6 }}
      />
      {stage && <p style={{ fontSize: ".82rem", marginTop: 4, fontWeight: 700 }}>{stage}</p>}
      {error && <p className="notice err" style={{ fontSize: ".82rem", marginTop: 6 }}>{error}</p>}
      {url && (
        <video src={url} controls muted playsInline style={{ marginTop: 8, maxHeight: 220, borderRadius: 10, maxWidth: "100%" }} />
      )}
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
        Portrait 9:16 and under a minute is what Reels and Shorts want. A Bunny class link or a YouTube link will
        not work — those are pages, not files, and Instagram has to download the file itself.
      </p>
    </div>
  );
}
