"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/app/components/Logo";

type Factor = { id: string; status: string; friendly_name?: string | null };

// One-time 2FA setup: scan the QR (or type the secret) into an authenticator app,
// then confirm with a 6-digit code. Also lets you remove a factor later.
export default function MfaEnroll({ required }: { required: boolean }) {
  const supabase = createClient();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function refresh() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function startEnroll() {
    setBusy(true);
    setErr(null);
    // Clean up any half-finished (unverified) enrolments first.
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.totp ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: enr, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Admin 2FA" });
    setBusy(false);
    if (error || !enr) return setErr(error?.message || "Could not start setup.");
    setEnrolling({ id: enr.id, qr: enr.totp.qr_code, secret: enr.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling || code.length < 6 || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.id, code: code.trim() });
    setBusy(false);
    if (error) return setErr("Code didn't match — wait for a fresh code in the app and try again.");
    setDone(true);
    setEnrolling(null);
    setCode("");
    refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Remove two-factor from your account? Your admin will be protected by password only until you set it up again.")) return;
    await supabase.auth.mfa.unenroll({ factorId: id });
    refresh();
  }

  const active = factors.filter((f) => f.status === "verified");

  return (
    <main>
      <header className="topbar">
        <Link href="/"><Logo /></Link>
      </header>
      <section className="narrow" style={{ paddingTop: 50, paddingBottom: 60 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.4rem", marginBottom: 6 }}>🔐 Two-factor authentication</h1>
          {required && active.length === 0 && !done && (
            <div className="notice" style={{ background: "rgba(234,179,8,.14)", border: "2px solid #eab308" }}>
              ⚠️ Two-factor is required for admin accounts. Set it up below (2 minutes) to continue to the admin panel.
            </div>
          )}
          {done && (
            <div className="notice ok">
              ✅ Two-factor is ON. From now on, admin login = password + the 6-digit code.
              <p style={{ margin: "8px 0 0" }}><Link className="btn small" href="/admin">Continue to admin →</Link></p>
            </div>
          )}

          {active.length > 0 && !enrolling && (
            <div style={{ margin: "12px 0" }}>
              <strong>✅ Active</strong>
              {active.map((f) => (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, background: "var(--bg-soft)", borderRadius: 10, padding: "8px 12px" }}>
                  <span style={{ fontSize: ".9rem" }}>📱 {f.friendly_name || "Authenticator app"}</span>
                  <button className="btn small secondary" type="button" onClick={() => remove(f.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          {!enrolling && active.length === 0 && (
            <>
              <p className="muted" style={{ fontSize: ".9rem" }}>
                Adds a second lock to your account: after your password, you&apos;ll type a 6-digit code from
                your phone. Works with <strong>Apple Passwords</strong> (built into your iPhone/Mac) or Google Authenticator.
              </p>
              <button className="btn block" type="button" disabled={busy} onClick={startEnroll}>
                {busy ? "Preparing…" : "Set up two-factor now"}
              </button>
            </>
          )}

          {enrolling && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>1) Add it to your authenticator</p>
              <p className="muted" style={{ fontSize: ".85rem" }}>
                On iPhone/Mac: open <strong>Passwords</strong> → your &ldquo;Website admin login&rdquo; entry → <strong>Set Up Verification Code</strong> → scan this QR (or enter the key below).
              </p>
              <div style={{ background: "#fff", borderRadius: 12, padding: 12, maxWidth: 220, margin: "10px auto" }}
                // Supabase returns the QR as a ready-made SVG for exactly this purpose.
                dangerouslySetInnerHTML={{ __html: enrolling.qr }}
              />
              <p className="muted" style={{ fontSize: ".78rem", textAlign: "center", wordBreak: "break-all" }}>
                Can&apos;t scan? Enter this setup key manually: <code>{enrolling.secret}</code>
              </p>
              <form onSubmit={confirm} style={{ marginTop: 14 }}>
                <p style={{ fontWeight: 700, marginBottom: 8 }}>2) Type the 6-digit code it shows</p>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  style={{ fontSize: "1.4rem", letterSpacing: "6px", textAlign: "center" }}
                />
                <button className="btn block" type="submit" disabled={busy || code.length < 6}>
                  {busy ? "Checking…" : "Confirm & switch on"}
                </button>
              </form>
            </div>
          )}
        </div>
        <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".78rem" }}>
          If you ever lose your phone, the factor can be reset securely from the database — you won&apos;t be locked out forever.
        </p>
      </section>
    </main>
  );
}
