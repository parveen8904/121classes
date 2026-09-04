"use client";

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { createBunnyUpload, bunnyVideoName } from "./bunnyActions";

// Upload a video file directly from the browser to Bunny Stream (resumable),
// then keep the resulting video GUID in a named field for the section form.
export default function BunnyUploader({ name, defaultValue = "" }: { name: string; defaultValue?: string }) {
  const [guid, setGuid] = useState(defaultValue);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  // WHAT THIS VIDEO IS CALLED ON BUNNY.
  //
  // A GUID identifies a video to a machine and to nobody else. Assigning class
  // numbers meant opening Bunny in another tab to see which lecture an id
  // belonged to — every time. Bunny already knows: we set the title from the
  // file name when the video object is created. This asks it back and puts it
  // on the same line as the id.
  type Named =
    | { state: "idle" | "loading" }
    | { state: "named"; title: string; lengthSec: number; ready: boolean }
    | { state: "missing" }        // Bunny has no such video — a bad paste
    | { state: "unreachable" }    // our side failed; the id may be fine
    | { state: "unconfigured" };
  const [named, setNamed] = useState<Named>({ state: "idle" });

  // Only the LAST lookup may write the label. Typing a GUID fires one request
  // per keystroke-settled value, and a slow early reply landing after a fast
  // later one would leave the wrong name under the right id.
  const asked = useRef(0);

  useEffect(() => {
    const id = guid.trim();
    if (!id) { setNamed({ state: "idle" }); return; }
    const mine = ++asked.current;
    setNamed({ state: "loading" });
    // A GUID is pasted or typed; wait for it to settle before asking.
    const t = setTimeout(async () => {
      const r = await bunnyVideoName(id);
      if (mine !== asked.current) return;
      if (r.ok) setNamed({ state: "named", title: r.title, lengthSec: r.lengthSec, ready: r.ready });
      else setNamed({ state: r.reason === "not_found" ? "missing" : r.reason === "unconfigured" ? "unconfigured" : "unreachable" });
    }, 400);
    return () => clearTimeout(t);
  }, [guid]);

  const hms = (sec: number) => {
    if (!sec) return "";
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  };

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
        // The name is NOT set from file.name here, though we know it: setGuid
        // starts the lookup, and a guessed label that is then replaced by
        // "Reading the name from Bunny…" reads as a glitch. Asking Bunny also
        // proves the video is really there under that id.
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
      </div>

      {/* THE NAME, IN FULL, UNDER THE ID.
          Shown whole and never shortened — the point is to tell one lecture
          from another, and "IND AS 2 Inventories part…" tells you nothing that
          "IND AS 2 Inventories part…" does not. The id is repeated beside it so
          the pair can be read together, which is the whole request. */}
      {guid.trim() && (
        <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--bg-soft)", borderRadius: 8, fontSize: ".84rem", lineHeight: 1.6 }}>
          {named.state === "loading" && <span className="muted">🎬 Reading the name from Bunny…</span>}

          {named.state === "named" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span aria-hidden>🎬</span>
                <strong style={{ wordBreak: "break-word" }}>
                  {named.title || <span className="muted" style={{ fontWeight: 400 }}>This video has no name on Bunny</span>}
                </strong>
                {named.lengthSec > 0 && <span className="muted" style={{ fontSize: ".8rem" }}>· {hms(named.lengthSec)}</span>}
                {/* Still encoding means it will not play yet, whatever the
                    section says. Better seen here than by a student. */}
                {!named.ready && <span className="badge" style={{ marginLeft: 2 }}>still processing on Bunny</span>}
              </div>
              <div className="muted" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".78rem", marginTop: 2, wordBreak: "break-all" }}>
                {guid.trim()}
              </div>
            </>
          )}

          {/* A WRONG ID AND A FAILED LOOKUP ARE NOT THE SAME NEWS.
              One means the id saved against this class points at nothing and
              must be fixed before saving; the other means Bunny did not answer
              us and the id may be perfectly good. Showing one blank box for
              both is how a mis-pasted id gets saved against a lecture. */}
          {named.state === "missing" && (
            <span style={{ color: "#b91c1c" }}>
              ⚠️ Bunny has no video with this ID — check the ID before saving, it will not play.
            </span>
          )}
          {named.state === "unreachable" && (
            <span className="muted">
              Could not reach Bunny to read the name just now — the ID itself may be fine. Reload to try again.
            </span>
          )}
          {named.state === "unconfigured" && (
            <span className="muted">
              The name cannot be read until BUNNY_STREAM_API_KEY is set (Admin → Integrations).
            </span>
          )}
        </div>
      )}
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
