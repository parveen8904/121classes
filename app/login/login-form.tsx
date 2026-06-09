"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "phone";

export default function LoginForm() {
  const supabase = createClient();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("password");
  const [signup, setSignup] = useState(false); // password tab: sign in vs create account

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function go() {
    router.push("/dashboard");
    router.refresh();
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    if (signup) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) return setMsg({ kind: "err", text: error.message });
      if (data.session) return go(); // confirmation disabled → logged in immediately
      setMsg({ kind: "ok", text: "Account created. If email confirmation is on, check your inbox; otherwise just sign in." });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) return setMsg({ kind: "err", text: error.message });
      go();
    }
  }

  async function magicLink() {
    if (!email) return setMsg({ kind: "err", text: "Enter your email first." });
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    setMsg(
      error
        ? { kind: "err", text: error.message }
        : { kind: "ok", text: "Check your email for a one-time sign-in link." },
    );
  }

  async function sendPhoneOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (error) return setMsg({ kind: "err", text: error.message });
    setOtpSent(true);
    setMsg({ kind: "ok", text: "We sent a 6-digit code to your phone." });
  }

  async function verifyPhoneOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    setLoading(false);
    if (error) return setMsg({ kind: "err", text: error.message });
    go();
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
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>
            {mode === "password" ? (signup ? "Create your account" : "Log in") : "Log in with phone"}
          </h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            Use email &amp; password, or your phone number.
          </p>

          <div className="tabs">
            <button
              className={mode === "password" ? "active" : ""}
              onClick={() => { setMode("password"); setMsg(null); }}
              type="button"
            >
              Email &amp; password
            </button>
            <button
              className={mode === "phone" ? "active" : ""}
              onClick={() => { setMode("phone"); setMsg(null); setOtpSent(false); }}
              type="button"
            >
              Phone
            </button>
          </div>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          {mode === "password" && (
            <form onSubmit={submitPassword}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Please wait…" : signup ? "Create account" : "Log in"}
              </button>

              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".85rem" }}>
                {signup ? "Already have an account? " : "New here? "}
                <button
                  type="button"
                  onClick={() => { setSignup(!signup); setMsg(null); }}
                  style={{ background: "none", border: 0, color: "var(--accent)", cursor: "pointer", padding: 0, font: "inherit" }}
                >
                  {signup ? "Log in" : "Create an account"}
                </button>
                {" · "}
                <button
                  type="button"
                  onClick={magicLink}
                  style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", padding: 0, font: "inherit", textDecoration: "underline" }}
                >
                  Email me a link instead
                </button>
              </p>
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
          Phone sign-in needs an SMS provider configured in Supabase.
        </p>
      </section>
    </main>
  );
}
