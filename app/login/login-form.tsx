"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Tab = "email" | "phone";
type Step = "enter" | "code";

export default function LoginForm() {
  const supabase = createClient();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("email");
  const [usePassword, setUsePassword] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailStep, setEmailStep] = useState<Step>("enter");
  const [emailCode, setEmailCode] = useState("");

  const [phone, setPhone] = useState("");
  const [phoneStep, setPhoneStep] = useState<Step>("enter");
  const [phoneCode, setPhoneCode] = useState("");

  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const rememberRow = (
    <label className="remember">
      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
      Keep me logged in on this device
    </label>
  );

  function go() {
    router.push("/dashboard");
    router.refresh();
  }
  function err(text: string) { setMsg({ kind: "err", text }); }
  function ok(text: string) { setMsg({ kind: "ok", text }); }

  // ---- Email: one-time code ----
  async function sendEmailCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (error) return err(error.message);
    setEmailStep("code");
    ok("We emailed you a 6-digit code. Enter it below.");
  }
  async function verifyEmailCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.verifyOtp({
      email, token: emailCode.trim(), type: "email",
    });
    setLoading(false);
    if (error) return err(error.message);
    go();
  }

  // ---- Email: password ----
  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return err(error.message);
    go();
  }

  // ---- Phone: one-time code ----
  async function sendPhoneCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (error) return err(error.message);
    setPhoneStep("code");
    ok("We sent a 6-digit code to your phone.");
  }
  async function verifyPhoneCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.verifyOtp({
      phone, token: phoneCode.trim(), type: "sms",
    });
    setLoading(false);
    if (error) return err(error.message);
    go();
  }

  const linkBtn = {
    background: "none", border: 0, color: "var(--accent)",
    cursor: "pointer", padding: 0, font: "inherit",
  } as const;

  return (
    <main>
      <header className="topbar">
        <Link className="logo" href="/">121 <span>CA Classes</span></Link>
      </header>

      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Log in or sign up</h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: ".9rem" }}>
            Quick and easy — get a one-time code, or use a password.
          </p>

          <div className="tabs">
            <button className={tab === "email" ? "active" : ""} type="button"
              onClick={() => { setTab("email"); setMsg(null); }}>Email</button>
            <button className={tab === "phone" ? "active" : ""} type="button"
              onClick={() => { setTab("phone"); setMsg(null); }}>Phone</button>
          </div>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          {/* EMAIL TAB */}
          {tab === "email" && !usePassword && emailStep === "enter" && (
            <form onSubmit={sendEmailCode}>
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              {rememberRow}
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Sending…" : "Email me a code"}
              </button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".85rem" }}>
                <button type="button" style={linkBtn}
                  onClick={() => { setUsePassword(true); setMsg(null); }}>Use a password instead</button>
              </p>
            </form>
          )}

          {tab === "email" && !usePassword && emailStep === "code" && (
            <form onSubmit={verifyEmailCode}>
              <label htmlFor="ecode">Enter the 6-digit code sent to {email}</label>
              <input id="ecode" inputMode="numeric" required value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)} placeholder="123456" />
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Verifying…" : "Verify & log in"}
              </button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".85rem" }}>
                <button type="button" style={linkBtn}
                  onClick={() => { setEmailStep("enter"); setEmailCode(""); setMsg(null); }}>
                  Use a different email / resend
                </button>
              </p>
            </form>
          )}

          {tab === "email" && usePassword && (
            <form onSubmit={passwordLogin}>
              <label htmlFor="pemail">Email address</label>
              <input id="pemail" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
              {rememberRow}
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Please wait…" : "Log in"}
              </button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".85rem" }}>
                Forgot it? <button type="button" style={linkBtn}
                  onClick={() => { setUsePassword(false); setMsg(null); }}>
                  Log in with an email code
                </button>{" "}— then set a new password on your dashboard.
              </p>
            </form>
          )}

          {/* PHONE TAB */}
          {tab === "phone" && phoneStep === "enter" && (
            <form onSubmit={sendPhoneCode}>
              <label htmlFor="phone">Phone number (with country code)</label>
              <input id="phone" type="tel" required value={phone}
                onChange={(e) => setPhone(e.target.value)} placeholder="+9198XXXXXXXX" />
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Sending…" : "Send code"}
              </button>
            </form>
          )}

          {tab === "phone" && phoneStep === "code" && (
            <form onSubmit={verifyPhoneCode}>
              <label htmlFor="pcode">Enter the 6-digit code sent to {phone}</label>
              <input id="pcode" inputMode="numeric" required value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value)} placeholder="123456" />
              <button className="btn block" disabled={loading} type="submit">
                {loading ? "Verifying…" : "Verify & log in"}
              </button>
              <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".85rem" }}>
                <button type="button" style={linkBtn}
                  onClick={() => { setPhoneStep("enter"); setPhoneCode(""); setMsg(null); }}>
                  Use a different number / resend
                </button>
              </p>
            </form>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: ".8rem" }}>
          Codes verify your email/phone instantly — no links to click. Phone needs an
          SMS provider configured in Supabase.
        </p>
      </section>
    </main>
  );
}
