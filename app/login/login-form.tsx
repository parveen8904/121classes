"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { claimDevice } from "../auth/session-actions";
import { registerWithVerification, sendPasswordReset } from "../auth/email-actions";

type Mode = "login" | "signup" | "forgot";

export default function LoginForm() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const reason = params.get("reason");

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    reason === "elsewhere"
      ? { kind: "err", text: "You were signed out because your account was used on another device of the same type." }
      : null,
  );
  const [loading, setLoading] = useState(false);

  const err = (text: string) => setMsg({ kind: "err", text });
  const ok = (text: string) => setMsg({ kind: "ok", text });

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      const m = error.message.toLowerCase();
      if (m.includes("confirm")) return err("Please verify your email first — check your inbox for the verification link.");
      return err("Email or password didn't match. New here? Tap “Create account”. Forgot it? Use “Forgot password”.");
    }
    await claimDevice();
    setLoading(false);
    router.push(next);
    router.refresh();
  }

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return err("Password must be at least 6 characters.");
    setLoading(true); setMsg(null);
    const fd = new FormData();
    fd.set("name", name); fd.set("email", email); fd.set("password", password);
    const r = await registerWithVerification(fd);
    setLoading(false);
    if (!r.ok) return err(r.error || "Could not sign up.");
    setMode("login");
    ok("Almost there! We've emailed you a verification link. Click it to activate your account, then log in here with your email and password.");
  }

  async function forgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const fd = new FormData();
    fd.set("email", email);
    const r = await sendPasswordReset(fd);
    setLoading(false);
    if (!r.ok) return err(r.error || "Could not send reset link.");
    setMode("login");
    ok("If an account exists for that email, we've sent a password-reset link. Check your inbox.");
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
            {mode === "signup" ? "Create your account" : mode === "forgot" ? "Forgot password" : "Log in"}
          </h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            {mode === "signup"
              ? "Sign up with your email — we'll email a link to verify it, then you log in with your password."
              : mode === "forgot"
              ? "Enter your email and we'll send you a link to set a new password."
              : "Log in with your email and password."}
          </p>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          {mode === "login" && (
            <form onSubmit={login}>
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Please wait…" : "Log in"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".88rem" }}>
                New here? <button type="button" style={linkBtn} onClick={() => { setMode("signup"); setMsg(null); }}>Create account</button>
              </p>
              <p className="muted" style={{ textAlign: "center", marginTop: 8, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setMode("forgot"); setMsg(null); }}>Forgot password?</button>
              </p>
            </form>
          )}

          {mode === "signup" && (
            <form onSubmit={signup}>
              <label htmlFor="name">Full name</label>
              <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              <label htmlFor="semail">Email address</label>
              <input id="semail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <p className="muted" style={{ fontSize: ".78rem", margin: "-6px 0 10px" }}>Use a real email — it's verified and can't be changed later.</p>
              <label htmlFor="spw">Choose a password</label>
              <input id="spw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Sending…" : "Create account"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".88rem" }}>
                Already have an account? <button type="button" style={linkBtn} onClick={() => { setMode("login"); setMsg(null); }}>Log in</button>
              </p>
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={forgot}>
              <label htmlFor="femail">Email address</label>
              <input id="femail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Sending…" : "Send reset link"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setMode("login"); setMsg(null); }}>← Back to login</button>
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
