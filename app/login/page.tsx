"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "email" | "phone";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function reset() {
    setMsg(null);
    setOtpSent(false);
    setCode("");
  }

  async function sendEmailLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    setMsg(
      error
        ? { kind: "err", text: error.message }
        : { kind: "ok", text: "Check your email for a sign-in link." },
    );
  }

  async function sendPhoneOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (error) {
      setMsg({ kind: "err", text: error.message });
    } else {
      setOtpSent(true);
      setMsg({ kind: "ok", text: "We sent a 6-digit code to your phone." });
    }
  }

  async function verifyPhoneOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });
    setLoading(false);
    if (error) {
      setMsg({ kind: "err", text: error.message });
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <main>
      <header className="topbar">
        <Link className="logo" href="/">
          121<span>Coaching</span>
        </Link>
      </header>

      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Log in or sign up</h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            Use your email or phone number — new users are created automatically.
          </p>

          <div className="tabs">
            <button
              className={mode === "email" ? "active" : ""}
              onClick={() => {
                setMode("email");
                reset();
              }}
              type="button"
            >
              Email
            </button>
            <button
              className={mode === "phone" ? "active" : ""}
              onClick={() => {
                setMode("phone");
                reset();
              }}
              type="button"
            >
              Phone
            </button>
          </div>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          {mode === "email" && (
            <form onSubmit={sendEmailLink}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}

          {mode === "phone" && !otpSent && (
            <form onSubmit={sendPhoneOtp}>
              <label htmlFor="phone">Phone number (with country code)</label>
              <input
                id="phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+9198XXXXXXXX"
              />
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Sending…" : "Send OTP"}
              </button>
            </form>
          )}

          {mode === "phone" && otpSent && (
            <form onSubmit={verifyPhoneOtp}>
              <label htmlFor="code">Enter the 6-digit code</label>
              <input
                id="code"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Verifying…" : "Verify & continue"}
              </button>
            </form>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".8rem" }}>
          Email sign-in uses a magic link · Phone sign-in needs an SMS provider
          configured in Supabase (see docs/PHASE1_SETUP.md).
        </p>
      </section>
    </main>
  );
}
