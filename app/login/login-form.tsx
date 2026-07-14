"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/app/components/Logo";
import { claimDevice } from "../auth/session-actions";
import { registerWithVerification, sendPasswordReset, requestLoginHelp } from "../auth/email-actions";

type Mode = "login" | "signup" | "forgot";

export default function LoginForm() {
  const supabase = createClient();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const reason = params.get("reason");

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  // After 2 failed logins, offer a human call-back (name + WhatsApp → admin inbox).
  const [failCount, setFailCount] = useState(0);
  const [helpName, setHelpName] = useState("");
  const [helpPhone, setHelpPhone] = useState("");
  const [helpSent, setHelpSent] = useState(false);

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
      setFailCount((c) => c + 1);
      // Count the failed attempt (admin Visitors report) — fire-and-forget.
      import("@/app/components/Tracker").then(({ track }) => track("login_failed", "/login")).catch(() => {});
      const m = error.message.toLowerCase();
      if (m.includes("confirm")) return err("Please verify your email first — check your inbox for the verification link.");
      return err("Email or password didn't match. New here? Tap “Create account”. Forgot it? Use “Forgot password”.");
    }
    import("@/app/components/Tracker").then(({ track }) => track("login_success", "/login")).catch(() => {});
    await claimDevice();
    // Full-page navigation so the freshly-set auth cookies are applied before
    // the next page loads. (router.push raced the cookie write and bounced the
    // user back to the login screen.) Keep `loading` true so the button stays
    // "Please wait…" until the new page takes over — no flicker back to "Log in".
    window.location.assign(next);
  }

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const fd = new FormData();
    fd.set("name", name); fd.set("email", email); fd.set("phone", phone);
    const r = await registerWithVerification(fd);
    setLoading(false);
    // Count signups (admin Visitors report) so a broken registration flow shows
    // up the same day, not via student complaints.
    import("@/app/components/Tracker").then(({ track }) => track(r.ok ? "signup_success" : "signup_failed", "/login")).catch(() => {});
    if (!r.ok) return err(r.error || "Could not sign up.");
    setMode("login");
    ok("Almost there! We've emailed you a verification link. Click it to verify your email — you'll then choose your password and you're in. No need to come back here.");
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
        <Link href="/"><Logo /></Link>
      </header>

      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>
            {mode === "signup" ? "Create your account" : mode === "forgot" ? "Forgot password" : "Log in"}
          </h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            {mode === "signup"
              ? "Just your email — we'll send a verification link. Click it to verify, then you choose your password."
              : mode === "forgot"
              ? "Enter your email and we'll send you a link to set a new password."
              : "Log in with your email and password."}
          </p>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          {mode === "login" && (
            <form onSubmit={login}>
              <label htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label htmlFor="pw">Password</label>
              <div style={{ position: "relative" }}>
                <input id="pw" name="password" type={showPw ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" style={{ paddingRight: 60 }} />
                <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: ".8rem", cursor: "pointer" }}>
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              <button className="btn block" disabled={loading} type="submit">{loading ? "Please wait…" : "Log in"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".88rem" }}>
                New here? <button type="button" style={linkBtn} onClick={() => { setMode("signup"); setMsg(null); }}>Create account</button>
              </p>
              <p className="muted" style={{ textAlign: "center", marginTop: 8, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setMode("forgot"); setMsg(null); }}>Forgot password?</button>
              </p>
            </form>
          )}

          {/* Trouble logging in? After 2 failed tries, offer a human call-back. */}
          {mode === "login" && failCount >= 2 && !helpSent && (
            <div style={{ marginTop: 14, border: "1px solid var(--accent)", borderRadius: 10, padding: "12px 14px", background: "var(--bg-soft)" }}>
              <strong style={{ fontSize: ".92rem" }}>😕 Trouble logging in? We&apos;ll call you.</strong>
              <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px" }}>Leave your name and WhatsApp number — our team will help you get in.</p>
              <input type="text" placeholder="Your name" value={helpName} onChange={(e) => setHelpName(e.target.value)} />
              <input type="tel" placeholder="WhatsApp number" value={helpPhone} onChange={(e) => setHelpPhone(e.target.value)} />
              <button
                type="button"
                className="btn small block"
                disabled={!helpPhone.trim()}
                onClick={async () => {
                  const fd = new FormData();
                  fd.set("name", helpName); fd.set("phone", helpPhone); fd.set("email", email);
                  await requestLoginHelp(fd).catch(() => null);
                  setHelpSent(true);
                }}
              >
                📞 Request a call-back
              </button>
            </div>
          )}
          {helpSent && (
            <p className="notice ok" style={{ marginTop: 12 }}>✅ Got it — our team will contact you on WhatsApp shortly.</p>
          )}

          {mode === "signup" && (
            <form onSubmit={signup}>
              <div style={{ border: "1px solid #eab308", background: "rgba(234,179,8,.12)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: ".82rem" }}>
                🚧 <strong>Beta version</strong> — the portal is still being developed and has not been formally
                launched. Some functions may not yet work as designed. Thank you for your patience!
              </div>
              <label htmlFor="name">Full name</label>
              <input id="name" name="name" type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              <label htmlFor="semail">Email address</label>
              <input id="semail" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <p className="muted" style={{ fontSize: ".78rem", margin: "-6px 0 10px" }}>Use a real email — it's verified and can't be changed later. We&apos;ll email you a link; you&apos;ll set your password after verifying.</p>
              <label htmlFor="sphone">WhatsApp number (optional)</label>
              <input id="sphone" name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98100 12345 — so we can help you if anything goes wrong" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Sending…" : "Send verification link"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".88rem" }}>
                Already have an account? <button type="button" style={linkBtn} onClick={() => { setMode("login"); setMsg(null); }}>Log in</button>
              </p>
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={forgot}>
              <label htmlFor="femail">Email address</label>
              <input id="femail" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
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
