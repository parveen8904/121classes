"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { claimDevice, needsPassword, markHasPassword } from "../auth/session-actions";

type Mode = "login" | "signup" | "code";

export default function LoginForm() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const reason = params.get("reason");

  const [mode, setMode] = useState<Mode>("login");
  const [codeSent, setCodeSent] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");

  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    reason === "elsewhere"
      ? { kind: "err", text: "You were signed out because your account was used on another device of the same type." }
      : null,
  );
  const [loading, setLoading] = useState(false);

  const err = (text: string) => setMsg({ kind: "err", text });
  const ok = (text: string) => setMsg({ kind: "ok", text });

  // After any successful auth: ensure a password exists, claim the device, go in.
  async function finish() {
    if (await needsPassword()) {
      router.push(`/auth/set-password?next=${encodeURIComponent(next)}`);
      router.refresh();
      return;
    }
    await claimDevice();
    router.push(next);
    router.refresh();
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return err("Email or password didn't match. New here? Tap “Create account”. Forgot your password? Use “Get a one-time code”.");
    await finish();
  }

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return err("Password must be at least 6 characters.");
    setLoading(true); setMsg(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) {
      setLoading(false);
      return err(error.message);
    }
    // Email confirmation is off → a session is returned immediately.
    if (data.session) {
      await markHasPassword();
      setLoading(false);
      await finish();
      return;
    }
    setLoading(false);
    // No session + no error usually means the email already has an account.
    err("Looks like you already have an account — please log in with your password.");
    setMode("login");
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setLoading(false);
    if (error) return err(error.message);
    setCodeSent(true);
    ok("If email is working, a 6-digit code is on its way. Enter it below.");
  }
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: emailCode.trim(), type: "email" });
    setLoading(false);
    if (error) return err(error.message);
    await finish();
  }

  const linkBtn = { background: "none", border: 0, color: "var(--accent)", cursor: "pointer", padding: 0, font: "inherit" } as const;

  return (
    <main>
      <header className="topbar">
        <Link className="logo" href="/">121 <span>CA Classes</span></Link>
      </header>

      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>
            {mode === "signup" ? "Create your account" : "Log in"}
          </h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            {mode === "signup"
              ? "Sign up with your email and a password — you're in straight away, no code needed."
              : "Log in with your email and password."}
          </p>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          {/* LOGIN */}
          {mode === "login" && (
            <form onSubmit={login}>
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Please wait…" : "Log in"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".88rem" }}>
                New here?{" "}
                <button type="button" style={linkBtn} onClick={() => { setMode("signup"); setMsg(null); }}>Create account</button>
              </p>
              <p className="muted" style={{ textAlign: "center", marginTop: 8, fontSize: ".82rem" }}>
                Forgot password?{" "}
                <button type="button" style={linkBtn} onClick={() => { setMode("code"); setCodeSent(false); setMsg(null); }}>Get a one-time code</button>
              </p>
            </form>
          )}

          {/* SIGN UP */}
          {mode === "signup" && (
            <form onSubmit={signup}>
              <label htmlFor="name">Full name</label>
              <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              <label htmlFor="semail">Email address</label>
              <input id="semail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label htmlFor="spw">Choose a password</label>
              <input id="spw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Creating…" : "Create account & log in"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".88rem" }}>
                Already have an account?{" "}
                <button type="button" style={linkBtn} onClick={() => { setMode("login"); setMsg(null); }}>Log in</button>
              </p>
            </form>
          )}

          {/* ONE-TIME CODE (fallback / reset) */}
          {mode === "code" && !codeSent && (
            <form onSubmit={sendCode}>
              <label htmlFor="cemail">Email address</label>
              <input id="cemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Sending…" : "Email me a code"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setMode("login"); setMsg(null); }}>← Back to login</button>
              </p>
            </form>
          )}
          {mode === "code" && codeSent && (
            <form onSubmit={verifyCode}>
              <label htmlFor="ecode">Enter the 6-digit code sent to {email}</label>
              <input id="ecode" inputMode="numeric" required value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="123456" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Verifying…" : "Verify & continue"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setCodeSent(false); setEmailCode(""); setMsg(null); }}>Resend / change email</button>
              </p>
            </form>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".8rem" }}>
          For your security, your account can be open on only one computer and one phone at a time.
        </p>
      </section>
    </main>
  );
}
