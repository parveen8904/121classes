"use client";

import { useState } from "react";
import * as tus from "tus-js-client";
import { createBunnyUpload } from "./bunnyActions";

// Upload a video file directly from the browser to Bunny Stream (resumable),
// then keep the resulting video GUID in a named field for the section form.
export default function BunnyUploader({ name, defaultValue = "" }: { name: string; defaultValue?: string }) {
  const [guid, setGuid] = useState(defaultValue);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("");
    setProgress(0);
    const init = await createBunnyUpload(file.name);
    if (!init.ok) {
      setProgress(null);
      setMsg(
        init.reason === "unconfigured"
          ? "Uploads need BUNNY_STREAM_API_KEY in Vercel. For now, upload in the Bunny dashboard and paste the ID."
          : "Could not start the upload. Please try again.",
      );
      e.target.value = "";
      return;
    }
    const upload = new tus.Upload(file, {
      endpoint: init.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: init.signature,
        AuthorizationExpire: String(init.expire),
        LibraryId: init.libraryId,
        VideoId: init.videoId,
      },
      metadata: { filetype: file.type, title: file.name },
      onError: () => {
        setMsg("Upload failed — check your connection and retry.");
        setProgress(null);
      },
      onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
      onSuccess: () => {
        setGuid(init.videoId);
        setProgress(null);
        setMsg("✅ Uploaded! Bunny is now processing it — it'll be ready to play shortly.");
      },
    });
    upload.start();
    e.target.value = "";
  }

  return (
    <div>
      <label>Bunny.net Stream video (secure premium player)</label>
      <input
        name={name}
        value={guid}
        onChange={(e) => setGuid(e.target.value)}
        placeholder="Video ID (GUID) — upload below, or paste from Bunny"
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <label className="btn small secondary" style={{ cursor: "pointer", margin: 0 }}>
          {progress !== null ? `Uploading ${progress}%` : "⬆️ Upload video to Bunny"}
          <input type="file" accept="video/*" onChange={onFile} style={{ display: "none" }} disabled={progress !== null} />
        </label>
        {guid && <span className="muted" style={{ fontSize: ".8rem" }}>🎬 {guid.slice(0, 8)}…</span>}
      </div>
      {progress !== null && (
        <div style={{ height: 6, background: "var(--bg-soft)", borderRadius: 6, marginTop: 8, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", transition: "width .2s" }} />
        </div>
      )}
      {msg && (
        <p className={`notice ${msg.startsWith("✅") ? "ok" : "err"}`} style={{ marginTop: 8 }}>
          {msg}
        </p>
      )}
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
        Big files upload directly &amp; resumably to Bunny. Keep this tab open until it reaches 100%, then
        Save the section.
      </p>
    </div>
  );
}
