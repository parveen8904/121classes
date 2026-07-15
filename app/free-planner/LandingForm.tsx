"use client";

import { useState } from "react";
import { registerFromLanding } from "./actions";

export default function LandingForm({ src }: { src: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "already">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setState("busy");
    const fd = new FormData(e.currentTarget);
    const r = await registerFromLanding(fd);
    if (!r.ok) { setError(r.error ?? "Something went wrong — please try again."); setState("idle"); return; }
    setState(r.already ? "already" : "done");
  }

  if (state === "done") {
    return (
      <div className="notice ok" style={{ marginTop: 4 }}>
        ✅ Almost there! We&apos;ve emailed you a verification link — click it, choose a password,
        and your free study planner is waiting inside. 📬
      </div>
    );
  }
  if (state === "already") {
    return (
      <div className="notice ok" style={{ marginTop: 4 }}>
        🎓 You already have an account! <a href="/login?next=/planner">Log in here</a> and open the planner
        from your dashboard. (Forgot your password? Use &ldquo;Forgot password&rdquo; on the login page.)
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="src" value={src} />
      <label>Your name</label>
      <input name="name" required autoComplete="name" placeholder="e.g. Rahul Verma" />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
        <div>
          <label>Email</label>
          <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        </div>
        <div>
          <label>WhatsApp number</label>
          <input name="phone" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile" />
        </div>
      </div>
      <label style={{ marginTop: 4 }}>Which exam are you preparing for?</label>
      <select name="level" defaultValue="">
        <option value="">— choose —</option>
        <option value="CA Foundation">CA Foundation</option>
        <option value="CA Intermediate">CA Intermediate</option>
        <option value="CA Final">CA Final</option>
        <option value="Other">Other</option>
      </select>
      {error && <p className="notice err" style={{ marginTop: 8 }}>{error}</p>}
      <button className="btn" type="submit" disabled={state === "busy"} style={{ marginTop: 12, width: "100%" }}>
        {state === "busy" ? "Creating your account…" : "📅 Get my free study plan →"}
      </button>
      <p className="muted" style={{ fontSize: ".76rem", marginTop: 8 }}>
        Free — no card needed. We&apos;ll email you a verification link; your details stay with us and are never sold.
      </p>
    </form>
  );
}
