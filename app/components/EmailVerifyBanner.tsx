"use client";

import { useState } from "react";
import { resendVerification } from "../auth/email-actions";

// Shown on the dashboard while the phone-first signup's email is still
// unverified. It never blocks anything — it just invites the student to click
// the link we emailed. One tap resends it.
export default function EmailVerifyBanner({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function resend() {
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.set("email", email);
    const r = await resendVerification(fd);
    setBusy(false);
    setMsg(r.ok ? "Sent — check your inbox (and spam) for the verification link." : (r.error || "Couldn't send just now."));
  }

  return (
    <div style={{ background: "#fef9c3", border: "1px solid #eab308", color: "#713f12", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: ".9rem" }}>
      <strong>📧 Please verify your email.</strong>{" "}
      We sent a link to <strong>{email}</strong> — clicking it confirms your address so you never lose access to your account.
      <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn small" type="button" onClick={resend} disabled={busy}>{busy ? "Sending…" : "Resend the link"}</button>
        {msg && <span style={{ fontSize: ".84rem" }}>{msg}</span>}
      </div>
    </div>
  );
}
