"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Set / change password. If the account has two-factor enabled, Supabase
// requires a fresh MFA check (AAL2) before it will change the password — so we
// step the user through a 6-digit code inline, then apply the new password.
export default function SetPassword() {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [needCode, setNeedCode] = useState(false); // MFA step-up required
  const [code, setCode] = useState("");

  // Friendly text for Supabase's various password errors.
  function friendly(raw: string): string {
    const m = raw.toLowerCase();
    if (m.includes("aal2")) return "__MFA__"; // signal: trigger step-up
    if (m.includes("weak") || m.includes("strength") || m.includes("pwned") || m.includes("compromis") || m.includes("breach"))
      return "That password is too weak or has appeared in a known data breach. Use a longer, unique password (mix of letters, numbers and a symbol).";
    if (m.includes("at least") || m.includes("length") || m.includes("6 char") || m.includes("8 char"))
      return "Password is too short — use at least 8 characters.";
    if (m.includes("same") || m.includes("different from")) return "Please choose a different password from your current one.";
    return raw;
  }

  async function applyPassword(): Promise<boolean> {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) return true;
    const f = friendly(error.message);
    if (f === "__MFA__") {
      // Two-factor is on — ask for a code, then retry.
      setNeedCode(true);
      setMsg({ kind: "err", text: "Two-factor is on for this account. Enter your 6-digit authenticator code to confirm the change." });
      return false;
    }
    setMsg({ kind: "err", text: f });
    return false;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setMsg({ kind: "err", text: "Use at least 8 characters." }); return; }
    setLoading(true);
    setMsg(null);
    const ok = await applyPassword();
    setLoading(false);
    if (ok) { setMsg({ kind: "ok", text: "✅ Password updated. Use it next time you log in." }); setPassword(""); setNeedCode(false); }
  }

  async function verifyThenSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    // Step up to AAL2 with the authenticator code.
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = data?.totp?.find((f) => f.status === "verified") ?? data?.totp?.[0];
    if (!totp) { setLoading(false); setMsg({ kind: "err", text: "No authenticator set up. Set up two-factor first, then change your password." }); return; }
    const { error: mfaErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.trim() });
    if (mfaErr) { setLoading(false); setMsg({ kind: "err", text: "That code didn't match — codes change every 30 seconds; try the newest one." }); return; }
    // Now AAL2 — apply the password.
    const ok = await applyPassword();
    setLoading(false);
    if (ok) { setMsg({ kind: "ok", text: "✅ Password updated." }); setPassword(""); setCode(""); setNeedCode(false); }
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
      <h3 style={{ marginBottom: 8 }}>Set / change password</h3>
      <p className="muted" style={{ fontSize: ".85rem", marginBottom: 14 }}>
        Use at least <strong>8 characters</strong> — a mix of letters, numbers and a symbol is safest.
        Avoid common passwords (they&apos;re rejected for your security).
      </p>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      {!needCode ? (
        <form onSubmit={save}>
          <label htmlFor="np">New password</label>
          <input id="np" type="password" required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
            autoComplete="new-password" />
          <button className="btn" disabled={loading} type="submit">
            {loading ? "Saving…" : "Save password"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyThenSave}>
          <label htmlFor="mfacode">🔐 6-digit authenticator code</label>
          <input id="mfacode" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456" style={{ fontSize: "1.3rem", letterSpacing: "6px", textAlign: "center" }} autoFocus />
          <button className="btn" disabled={loading || code.length < 6} type="submit">
            {loading ? "Confirming…" : "Confirm & change password"}
          </button>
        </form>
      )}
    </div>
  );
}
