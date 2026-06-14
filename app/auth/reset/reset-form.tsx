"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetForm() {
  const supabase = createClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      return setMsg({ kind: "err", text: "Passwords don't match." });
    }
    setLoading(true);
    setMsg(null);
    // Requires the recovery session set by clicking the email reset link.
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setMsg({ kind: "err", text: error.message });
    } else {
      setMsg({ kind: "ok", text: "Password updated. Taking you in…" });
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <main>
      <header className="topbar">
        <Link className="logo" href="/">
          121 <span>CA Classes</span>
        </Link>
      </header>

      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Set a new password</h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            Enter your new password below.
          </p>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          <form onSubmit={submit}>
            <label htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
            />
            <button className="btn block" disabled={loading} type="submit">
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>

          <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".8rem" }}>
            If this page says your session is missing, open the reset link from your
            email again (it logs you in to set the password).
          </p>
        </div>
      </section>
    </main>
  );
}
