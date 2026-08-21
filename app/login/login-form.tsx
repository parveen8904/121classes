"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { claimDevice } from "../auth/session-actions";
import { registerWithVerification, sendPasswordReset, requestLoginHelp, autoLoginRescue } from "../auth/email-actions";
import { resetSendOtp, resetVerifyAndSet } from "../auth/reset-actions";
import { PASSWORD_RULE } from "@/lib/passwordRule";

type Mode = "login" | "signup" | "forgot";

export default function LoginForm() {
  const supabase = createClient();
  const params = useSearchParams();
  // No "next" of their own? The server decides where they belong — a warehouse
  // packer to the warehouse, a student to their dashboard. The browser cannot
  // make that call, because it cannot be trusted to read permissions.
  const next = params.get("next") || "/auth/home";
  const reason = params.get("reason");
  // /auth/confirm sends people here when their email link no longer works —
  // usually because it was already used (a mail scanner can open it first) or
  // it simply sat in the inbox too long. Say so plainly and open the form that
  // sends a fresh one, rather than a bare "authentication error".
  const linkFailed = params.get("error") === "auth";
  // The phone-first /signup sends people here with ?signup=1 when WhatsApp OTP
  // is unavailable, so they land straight on the email sign-up as a fallback.
  const wantSignup = params.get("signup") === "1";

  const [mode, setMode] = useState<Mode>(linkFailed ? "forgot" : wantSignup ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  // WhatsApp password reset (for students who can't get the email link).
  const [waStep, setWaStep] = useState<"" | "send" | "verify">("");
  const [code, setCode] = useState("");
  // After 2 failed logins, offer a human call-back (name + WhatsApp → admin inbox).
  const [failCount, setFailCount] = useState(0);
  const [helpName, setHelpName] = useState("");
  const [helpPhone, setHelpPhone] = useState("");
  const [helpSent, setHelpSent] = useState(false);

  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    reason === "elsewhere"
      ? { kind: "err", text: "You were signed out because your account was used on another device of the same type." }
      : linkFailed
        ? { kind: "err", text: "That link has already been used or has expired. Enter your email below and we'll send you a fresh one." }
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

      // Whatever the reason, the answer is the same: send them the link that
      // lets them choose a password. The server says nothing about whether the
      // address is registered — the link goes to the mailbox, not the screen.
      try {
        const fd = new FormData();
        fd.set("email", email);
        const r = await autoLoginRescue(fd);
        // Their address cannot receive mail. Another link would bounce like all
        // the others, so say what is actually wrong — with the correction in it.
        if (r.badAddress) {
          return err(
            `${r.badAddress} If that address is the one on your account, WhatsApp us on 98100 79162 ` +
            `and we will correct it for you — you will not be able to log in until it is fixed.`,
          );
        }
        if (r.throttled) {
          return ok("We have already emailed you a sign-in link in the last few minutes. Please open it — and do check your spam folder.");
        }
        if (r.noAccount) {
          // Say it plainly and open the right form with their email already in
          // it, rather than leaving them to work out that "Create account" is
          // the thing they need.
          setMode("signup");
          return err(
            `We could not find an account for ${email}. It looks like you have not registered yet — ` +
            `your name and this email are all it takes, and it is free. If you think you registered with a ` +
            `different email address, WhatsApp us on 98100 79162 and we will find it for you.`,
          );
        }
      } catch { /* fall through */ }
      return ok(
        "We have emailed you a link to choose your password — open it and you are straight in. " +
        "It works whether you forgot your password or never set one. Check your spam folder too.",
      );
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
    if (!r.ok) {
      // ALREADY REGISTERED IS NOT A FAILURE, IT IS THE OTHER DOOR.
      //
      // Nine sign-ups failed today and this is what most of them are: somebody
      // who already has an account, pressing Create account because that is
      // what a person does when they cannot get in. Answering "an account with
      // this email already exists" leaves them exactly where they started.
      // Send them the link and put them on the log-in form instead.
      if (/already/i.test(r.error ?? "")) {
        try {
          const fd2 = new FormData();
          fd2.set("email", email);
          await autoLoginRescue(fd2);
        } catch { /* the message below still stands */ }
        setMode("login");
        return ok(
          "You already have an account with this email — so there is nothing to create. " +
          "We have emailed you a link to choose your password; open it and you are straight in. " +
          "Check your spam folder too.",
        );
      }
      return err(r.error || "Could not sign up.");
    }
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

  async function waSendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const fd = new FormData();
    fd.set("phone", phone);
    const r = await resetSendOtp(fd);
    setLoading(false);
    if (!r.ok) return err(r.error);
    setWaStep("verify");
    ok(r.hint);
  }

  async function waSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const fd = new FormData();
    fd.set("phone", phone); fd.set("code", code); fd.set("password", password);
    const r = await resetVerifyAndSet(fd);
    if (!r.ok) { setLoading(false); return err(r.error); }
    // New password set — sign them straight in with it.
    const { error } = await supabase.auth.signInWithPassword({ email: r.email, password });
    if (error) {
      setLoading(false);
      setMode("login");
      return ok("Your password is reset — please log in with your email and the new password.");
    }
    window.location.assign(next);
  }

  const linkBtn = { background: "none", border: 0, color: "var(--accent)", cursor: "pointer", padding: 0, font: "inherit" } as const;

  return (
    <main>
      {/* No brand header here — the global site header already shows the logo
          + tagline; a second one directly below it looked duplicated (seen on
          the iPhone app's login screen). */}
      <section className="narrow" style={{ paddingTop: 40 }}>
        <div className="card">
          {/* TWO DOORS, THE SAME SIZE.
              This screen opened on "Log in" with Create account as a small line
              of text underneath — and the app opens here too, so it is the
              first thing a brand-new student sees. They typed an email and
              invented a password, because that is what a login form asks for.
              Ten of the first twenty-eight people who asked us for help getting
              in had no account at all; they had never registered. Nobody chose
              the wrong door on purpose. It was simply the only one that looked
              like a door. */}
          {mode !== "forgot" && (
            <div role="tablist" aria-label="Log in or create an account"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
              {([["login", "Log in"], ["signup", "Create account"]] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    // "Create account" now opens the phone-first sign-up. The
                    // inline email flow stays as a fallback (reached via
                    // /login?signup=1 when WhatsApp OTP is unavailable).
                    if (m === "signup") { window.location.assign("/signup"); return; }
                    setMode(m); setMsg(null);
                  }}
                  className={mode === m ? "btn" : "btn secondary"}
                  style={{ width: "100%", padding: "10px 8px", fontSize: ".95rem" }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {mode === "forgot" && (
            <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Forgot password</h1>
          )}
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            {mode === "signup"
              ? "Just your email — we'll send a verification link. Click it to verify, then you choose your password."
              : mode === "forgot"
              ? "Reset your password two ways — by an email link, or by a WhatsApp code to your registered mobile. Use whichever you can access."
              : "Already registered? Log in below. If you have never made an account here, use Create account above — it takes a minute."}
          </p>

          {/* One line, not four. Students who were GIVEN access never chose a
              password, so "log in with your email and password" is advice they
              cannot follow — but a failed login now emails them the link by
              itself, so this only has to reassure, not instruct. */}
          {mode === "login" && (
            <p className="muted" style={{ fontSize: ".84rem", lineHeight: 1.6, marginTop: -6, marginBottom: 18 }}>
              Never set a password, or your link expired? Enter your email and press Log in — we send you a fresh
              link straight away. Your access is already on your account.
            </p>
          )}

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
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setMode("forgot"); setMsg(null); }}>Forgot password?</button>
                {" · "}
                <span>First time here? Use <strong>Create account</strong> above.</span>
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
              <label htmlFor="name">Full name</label>
              <input id="name" name="name" type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              <label htmlFor="semail">Email address</label>
              <input id="semail" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <p className="muted" style={{ fontSize: ".78rem", margin: "-6px 0 10px" }}>Use a real email — it's verified and can't be changed later. We&apos;ll email you a link; you&apos;ll set your password after verifying.</p>
              <label htmlFor="sphone">WhatsApp number</label>
              <input id="sphone" name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98100 12345 — class alerts and test reports come here" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Sending…" : "Send verification link"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".88rem" }}>
                Already have an account? <button type="button" style={linkBtn} onClick={() => { setMode("login"); setMsg(null); }}>Log in</button>
              </p>
            </form>
          )}

          {mode === "forgot" && waStep === "" && (
            <>
              {/* Two equal ways to reset — email link OR WhatsApp code. */}
              <form onSubmit={forgot}>
                <label htmlFor="femail">📧 Reset by email</label>
                <input id="femail" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <button className="btn block" disabled={loading} type="submit">{loading ? "Sending…" : "Send reset link"}</button>
              </form>

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span className="muted" style={{ fontSize: ".8rem" }}>or</span>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>

              <label>📱 Reset by WhatsApp</label>
              <p className="muted" style={{ fontSize: ".8rem", margin: "0 0 8px" }}>
                A code to your registered mobile — handy if you can&apos;t reach your email.
              </p>
              <button type="button" className="btn block" onClick={() => { setWaStep("send"); setMsg(null); }}>
                Reset with WhatsApp →
              </button>

              <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setMode("login"); setMsg(null); }}>← Back to login</button>
              </p>
            </>
          )}

          {mode === "forgot" && waStep === "send" && (
            <form onSubmit={waSendCode}>
              <label htmlFor="waphone">Registered mobile number</label>
              <input id="waphone" name="phone" inputMode="numeric" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" autoComplete="tel" />
              <button className="btn block" disabled={loading} type="submit">{loading ? "Sending…" : "Send WhatsApp code →"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setWaStep(""); setMsg(null); }}>← Use email instead</button>
              </p>
            </form>
          )}

          {mode === "forgot" && waStep === "verify" && (
            <form onSubmit={waSetPassword}>
              <label htmlFor="wacode">WhatsApp code</label>
              <input id="wacode" name="code" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" autoFocus />
              <label htmlFor="wapw">New password</label>
              <input id="wapw" name="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="muted" style={{ fontSize: ".78rem", marginTop: 4 }}>{PASSWORD_RULE}</p>
              <button className="btn block" disabled={loading} type="submit">{loading ? "Setting…" : "Set new password & sign in →"}</button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".82rem" }}>
                <button type="button" style={linkBtn} onClick={() => { setWaStep("send"); setCode(""); setMsg(null); }}>← Resend / change number</button>
              </p>
            </form>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".8rem" }}>
          For your security, your account stays open on one computer, one phone browser and the app — not more.
        </p>
      </section>
    </main>
  );
}
