"use client";

import { useState } from "react";
import { passwordProblem, friendlyPasswordError, PASSWORD_RULE } from "@/lib/passwordRule";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/app/components/Logo";
import { markHasPassword, claimDevice, clearPasswordResetGate } from "../session-actions";

// Password setup / reset. If the account has two-factor on (admins do), Supabase
// requires a fresh MFA check (AAL2) before changing the password — so we step
// the user through their 6-digit code inline, then apply the new password.
export default function SetPasswordForm({ next }: { next: string }) {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");

  async function apply(): Promise<boolean> {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) return true;
    const f = friendlyPasswordError(error.message);
    if (f === "__MFA__") { setNeedCode(true); setErr("🔐 Two-factor is on for your account. Enter your 6-digit authenticator code below to confirm the change."); return false; }
    setErr(f);
    return false;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // Checked here before the server is asked, so the answer names the one
    // thing that is missing instead of a rule they have to guess at.
    const problem = passwordProblem(password);
    if (problem) return setErr(problem);
    if (password !== confirm) return setErr("Both passwords must match.");
    setBusy(true);
    const ok = await apply();
    if (ok) { await markHasPassword(); await claimDevice(); await clearPasswordResetGate(); window.location.assign(next); return; }
    setBusy(false);
  }

  async function verifyThenSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = data?.totp?.find((f) => f.status === "verified") ?? data?.totp?.[0];
    if (!totp) { setBusy(false); return setErr("No authenticator found on this account. Please contact support."); }
    const { error: mfaErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.trim() });
    if (mfaErr) { setBusy(false); return setErr("That code didn't match — codes change every 30 seconds; type the newest one from your authenticator."); }
    const ok = await apply();
    if (ok) { await markHasPassword(); await claimDevice(); await clearPasswordResetGate(); window.location.assign(next); return; }
    setBusy(false);
  }

  return (
    <main>
      <header className="topbar">
        <Link href="/"><Logo /></Link>
      </header>
      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Set your password 🔐</h1>
          <p className="muted" style={{ marginBottom: 16, fontSize: ".9rem" }}>
            {PASSWORD_RULE} It doesn&apos;t need to be complicated —
            just <strong>not a common one</strong> (very common passwords are rejected for safety).
          </p>
          {err && <div className={`notice ${needCode ? "" : "err"}`}>{err}</div>}

          {!needCode ? (
            <form onSubmit={submit}>
              <label htmlFor="np">New password</label>
              <div style={{ position: "relative" }}>
                <input id="np" type={showPw ? "text" : "password"} required value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="e.g. Study@2026" style={{ paddingRight: 60 }} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: ".8rem", cursor: "pointer" }}>
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              {/* Said while they type, not after they press. The whole reason
                  this went wrong is that the requirement only ever appeared as
                  a refusal, and the refusal named the wrong requirement. */}
              {password.length > 0 && (
                <p className="muted" style={{ fontSize: ".82rem", marginTop: -6 }}>
                  {passwordProblem(password) ?? "✅ That will do nicely."}
                </p>
              )}
              <label htmlFor="cp">Confirm password</label>
              <input id="cp" type={showPw ? "text" : "password"} required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder="Re-type your password" autoComplete="new-password" />
              <button className="btn block" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save password & continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyThenSave}>
              <label htmlFor="mfacode">6-digit authenticator code</label>
              <input id="mfacode" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456"
                style={{ fontSize: "1.4rem", letterSpacing: "6px", textAlign: "center" }} autoFocus />
              <button className="btn block" disabled={busy || code.length < 6} type="submit">
                {busy ? "Confirming…" : "Confirm & set password"}
              </button>
              <p className="muted" style={{ fontSize: ".78rem", marginTop: 10 }}>
                Open your authenticator app (Apple Passwords / Google Authenticator) and use the code shown for <strong>CA Parveen Sharma admin</strong>.
              </p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
