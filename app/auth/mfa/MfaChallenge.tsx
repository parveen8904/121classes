"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { trustThisDevice } from "@/app/auth/session-actions";
import Logo from "@/app/components/Logo";

// Second step of admin login: enter the 6-digit code from the authenticator app.
export default function MfaChallenge({ next }: { next: string }) {
  const supabase = createClient();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setErr(error.message);
      const totp = data?.totp?.find((f) => f.status === "verified") ?? data?.totp?.[0];
      if (!totp) {
        window.location.assign("/auth/mfa/setup?required=1");
        return;
      }
      setFactorId(totp.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || code.length < 6 || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) {
      setBusy(false);
      setErr("That code didn't match — check the app and try again (codes change every 30 seconds).");
      return;
    }
    if (remember) { try { await trustThisDevice(); } catch { /* non-fatal */ } }
    window.location.assign(next);
  }

  return (
    <main>
      <header className="topbar">
        <Link href="/"><Logo /></Link>
      </header>
      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.4rem", marginBottom: 6 }}>🔐 Two-factor check</h1>
          <p className="muted" style={{ marginBottom: 18, fontSize: ".9rem" }}>
            Open your authenticator (Apple Passwords / Google Authenticator) and enter the
            6-digit code for <strong>CA Parveen Sharma admin</strong>.
          </p>
          {err && <div className="notice err">{err}</div>}
          <form onSubmit={verify}>
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              style={{ fontSize: "1.4rem", letterSpacing: "6px", textAlign: "center" }}
              autoFocus
            />
            <label className="remember" style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", fontSize: ".88rem" }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember this device for 30 days (skip the code on this browser)
            </label>
            <button className="btn block" type="submit" disabled={busy || code.length < 6 || !factorId}>
              {busy ? "Checking…" : "Verify & continue"}
            </button>
          </form>
          <p className="muted" style={{ marginTop: 14, fontSize: ".78rem" }}>
            Lost your phone? Contact the site developer — the factor can be reset securely from the database.
          </p>
        </div>
      </section>
    </main>
  );
}
