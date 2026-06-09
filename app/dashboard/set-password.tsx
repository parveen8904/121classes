"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SetPassword() {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) setMsg({ kind: "err", text: error.message });
    else {
      setMsg({ kind: "ok", text: "Password set. You can now log in with email + password." });
      setPassword("");
    }
  }

  if (!open) {
    return (
      <button className="btn secondary" type="button" onClick={() => setOpen(true)}>
        Set / change password
      </button>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 420, marginTop: 16 }}>
      <h3 style={{ marginBottom: 8 }}>Set a password (optional)</h3>
      <p className="muted" style={{ fontSize: ".85rem", marginBottom: 14 }}>
        Lets you log in with email + password next time, instead of a code.
      </p>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      <form onSubmit={save}>
        <label htmlFor="np">New password</label>
        <input id="np" type="password" required minLength={6} value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
        <button className="btn" disabled={loading} type="submit">
          {loading ? "Saving…" : "Save password"}
        </button>
      </form>
    </div>
  );
}
