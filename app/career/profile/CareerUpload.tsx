"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Resume and photograph go straight from the browser to the student's OWN
// folder in the private bucket — the same direct-upload shape the answer books
// use, and for the same reason: a server action tops out at 8 MB and a phone
// should not find that out after waiting.
export default function CareerUpload({
  kind, current,
}: { kind: "resume" | "photo"; current: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [ref, setRef] = useState<string>("");
  const accept = kind === "resume" ? "application/pdf,.pdf" : "image/*";
  const field = kind === "resume" ? "resume_url" : "photo_url";

  async function up(file: File) {
    setMsg("Uploading…");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMsg("Please sign in again."); return; }
    if (kind === "resume" && file.size > 8 * 1024 * 1024) { setMsg("Keep the resume under 8 MB."); return; }
    if (kind === "photo" && file.size > 5 * 1024 * 1024) { setMsg("Keep the photo under 5 MB."); return; }
    const ext = kind === "resume" ? "pdf" : (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `career/${user.id}/${kind}.${ext}`;
    const { error } = await supabase.storage.from("secure")
      .upload(path, file, { contentType: file.type || undefined, upsert: true });
    if (error) { setMsg(`Could not upload: ${error.message}`); return; }
    setRef(`secure:${path}`);
    setMsg("Uploaded ✓ — press Save below to keep it");
  }

  return (
    <div>
      <input type="file" accept={accept} onChange={(e) => { const f = e.target.files?.[0]; if (f) void up(f); }} />
      <input type="hidden" name={field} value={ref} />
      {msg ? <p style={{ fontSize: ".82rem", fontWeight: 700, margin: "4px 0 0" }}>{msg}</p>
        : current ? <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>Already on file — choosing a new file replaces it.</p> : null}
    </div>
  );
}
