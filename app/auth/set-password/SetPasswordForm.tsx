"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { markHasPassword, claimDevice } from "../session-actions";

// Mandatory one-time password setup. After this, the student always logs in with
// their password — no more codes.
export default function SetPasswordForm({ next }: { next: string }) {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    if (password !== confirm) return setErr("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setErr(error.message);
    }
    await markHasPassword();
    await claimDevice();
    window.location.assign(next);
  }

  return (
    <main>
      <header className="topbar">
        <Link href="/">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo-cps.png" alt="CA Parveen Sharma" className="brand-logo" /></Link>
      </header>
      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Set your password 🔐</h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            One quick step — choose a password. From next time you&apos;ll just log in with it,
            no codes needed.
          </p>
          {err && <div className="notice err">{err}</div>}
          <form onSubmit={submit}>
            <label htmlFor="np">New password</label>
            <input id="np" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            <label htmlFor="cp">Confirm password</label>
            <input id="cp" type="password" required value={confirm}
              onChange={(e) => setConfirm(e.target.value)} placeholder="Re-type your password" />
            <button className="btn block" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save password & continue"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
