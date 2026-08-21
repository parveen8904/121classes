"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { signupSendOtp, signupComplete } from "../auth/signup-actions";
import { PASSWORD_RULE } from "@/lib/passwordRule";

// Phone-first sign-up: name + mobile + email → WhatsApp OTP → password → in.
export default function SignupForm() {
  const supabase = createClient();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setNote(null); setBusy(true);
    const fd = new FormData();
    fd.set("name", name); fd.set("email", email.trim()); fd.set("phone", phone);
    const r = await signupSendOtp(fd);
    setBusy(false);
    if (r.ok) { setStep("otp"); setNote(`We've sent a code on WhatsApp to ${phone}. Enter it below.`); return; }
    if ("fallback" in r && r.fallback) {
      // OTP unavailable — send them to the email sign-up so they are never stuck.
      window.location.assign(`/login?signup=1&email=${encodeURIComponent(email.trim())}`);
      return;
    }
    setError(r.error);
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setNote(null); setBusy(true);
    const fd = new FormData();
    fd.set("name", name); fd.set("email", email.trim()); fd.set("phone", phone);
    fd.set("code", code); fd.set("password", password);
    const r = await signupComplete(fd);
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    // Phone proven, account made — sign them straight in with their password.
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: r.email, password });
    if (signInErr) {
      setBusy(false);
      setNote("Your account is created — please log in with your email and the password you just set.");
      setTimeout(() => window.location.assign("/login"), 1500);
      return;
    }
    // window.location (not router) so the freshly-set cookie is sent on the next load.
    window.location.assign("/auth/home");
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: 4 }}>Create your account</h1>
      <p className="muted" style={{ fontSize: ".9rem", marginTop: 0 }}>
        Free. Takes a minute — we verify your mobile on WhatsApp, you pick a password, and you&apos;re in.
      </p>

      {note && <p className="notice ok" style={{ fontSize: ".85rem" }}>{note}</p>}
      {error && <p className="notice err" style={{ fontSize: ".85rem" }}>{error}</p>}

      {step === "form" ? (
        <form onSubmit={sendCode} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
          <label>Mobile number (WhatsApp)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric"
              placeholder="10-digit mobile" required autoComplete="tel" />
          </label>
          <label>Email address
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
              placeholder="you@example.com" required autoComplete="email" />
          </label>
          <button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Send WhatsApp code →"}</button>
        </form>
      ) : (
        <form onSubmit={createAccount} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>WhatsApp code
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
              placeholder="6-digit code" required autoFocus />
          </label>
          <label>Choose a password
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
              autoComplete="new-password" required />
          </label>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: -4 }}>{PASSWORD_RULE}</p>
          <button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create my account →"}</button>
          <button type="button" className="btn small secondary" disabled={busy}
            onClick={() => { setStep("form"); setCode(""); setError(null); setNote(null); }}>
            ← Change my number
          </button>
        </form>
      )}

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 18 }}>
        Already have an account? <Link href="/login" className="grad">Log in</Link>
      </p>
    </div>
  );
}
