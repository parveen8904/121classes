"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { resendVerification } from "../email-actions";

export default function VerifyPending({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function resend() {
    start(async () => {
      const fd = new FormData();
      fd.set("email", email);
      const r = await resendVerification(fd);
      setNote(r.ok ? "✅ Sent! Check your inbox (and spam)." : r.error || "Couldn't resend.");
    });
  }

  return (
    <main>
      <header className="topbar">
        <Link className="logo" href="/">121 <span>CA Classes</span></Link>
      </header>
      <section className="narrow" style={{ paddingTop: 60 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2.4rem" }}>📩</div>
          <h1 style={{ fontSize: "1.4rem", margin: "8px 0" }}>Verify your email</h1>
          <p className="muted" style={{ fontSize: ".92rem" }}>
            We&apos;ve sent a verification link to <strong>{email}</strong>. Click it to activate your
            account, then come back and log in.
          </p>
          {note && <div className="notice ok" style={{ marginTop: 14 }}>{note}</div>}
          <button className="btn block" style={{ marginTop: 18 }} disabled={pending} onClick={resend}>
            {pending ? "Sending…" : "Resend verification email"}
          </button>
          <p className="muted" style={{ marginTop: 14, fontSize: ".82rem" }}>
            <Link href="/auth/signout" style={{ color: "var(--accent)" }}>Log out</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
