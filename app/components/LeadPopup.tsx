"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { startCaseTrial, confirmCaseTrial } from "@/app/try/actions";

// Case-scenario teaser popup on PUBLIC marketing pages. Flow:
//   offer → contact (name/email/WhatsApp) → codes (email + WhatsApp OTP) → play.
// Both contacts are VERIFIED before the test unlocks, so the captured lead is
// real. Never shows to logged-in users; dismiss = quiet for 14 days; verified =
// never again. Session detected client-side to keep the root layout cacheable.

const SHOW_ON = ["/", "/courses", "/books", "/test-series", "/placements", "/results", "/career"];
const DISMISS_KEY = "leadpop.dismissed";
const DONE_KEY = "leadpop.done";

export default function LeadPopup() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"offer" | "contact" | "codes" | "done">("offer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verifId, setVerifId] = useState("");
  const [phoneSent, setPhoneSent] = useState(false);

  useEffect(() => {
    const allowed = SHOW_ON.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")));
    if (!allowed) return;
    try {
      if (localStorage.getItem(DONE_KEY)) return;
      const dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (dismissed && Date.now() - dismissed < 14 * 86400e3) return;
    } catch { return; }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const { data } = await createClient().auth.getSession();
        if (!cancelled && !data.session) setOpen(true);
      } catch {
        if (!cancelled) setOpen(true);
      }
    }, 12000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pathname]);

  if (!open) return null;

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    setOpen(false);
  }

  async function onContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setBusy(true);
    const r = await startCaseTrial(new FormData(e.currentTarget));
    setBusy(false);
    if (!r.ok || !r.id) { setError(r.error ?? "Please try again."); return; }
    setVerifId(r.id);
    setPhoneSent(Boolean(r.phoneSent));
    setStep("codes");
  }

  async function onCodes(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setBusy(true);
    const fd = new FormData(e.currentTarget);
    fd.set("id", verifId);
    const r = await confirmCaseTrial(fd);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Please try again."); return; }
    try { localStorage.setItem(DONE_KEY, "1"); } catch { /* private mode */ }
    setStep("done");
  }

  return (
    <div
      role="dialog"
      aria-label="Try a free case scenario"
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={dismiss}
    >
      <div className="form-card" style={{ maxWidth: 430, width: "100%", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button onClick={dismiss} aria-label="Close" style={{ position: "absolute", top: 8, right: 12, background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: "var(--muted)" }}>×</button>

        {step === "offer" && (
          <div>
            <h3 style={{ marginTop: 0 }}>🧩 Test yourself — free CA case scenario</h3>
            <p className="muted" style={{ fontSize: ".88rem" }}>
              Try a REAL case-based scenario with MCQs — the new exam pattern — and see your score instantly.
              From CA Parveen Sharma (36 years of teaching).
            </p>
            <button className="btn" style={{ width: "100%" }} onClick={() => setStep("contact")}>Yes, I want to try →</button>
            <button onClick={dismiss} style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: ".8rem" }}>No thanks</button>
          </div>
        )}

        {step === "contact" && (
          <form onSubmit={onContact}>
            <h3 style={{ marginTop: 0 }}>Where do we send your codes?</h3>
            <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>We verify both so only real students get the test — you&apos;ll enter the codes on the next step.</p>
            <label>Name</label>
            <input name="name" required autoComplete="name" />
            <label style={{ marginTop: 6 }}>Email</label>
            <input name="email" type="email" required autoComplete="email" />
            <label style={{ marginTop: 6 }}>WhatsApp number</label>
            <input name="phone" inputMode="numeric" autoComplete="tel" placeholder="10-digit" required />
            {error && <p className="notice err" style={{ marginTop: 8 }}>{error}</p>}
            <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10, width: "100%" }}>
              {busy ? "Sending codes…" : "Send my verification codes →"}
            </button>
          </form>
        )}

        {step === "codes" && (
          <form onSubmit={onCodes}>
            <h3 style={{ marginTop: 0 }}>Enter your codes</h3>
            <label>📧 Code from your email</label>
            <input name="email_code" inputMode="numeric" maxLength={6} required placeholder="6 digits" />
            {phoneSent ? (
              <>
                <label style={{ marginTop: 6 }}>💬 Code from WhatsApp</label>
                <input name="phone_code" inputMode="numeric" maxLength={6} required placeholder="6 digits" />
              </>
            ) : (
              <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>WhatsApp code isn&apos;t needed this time — the email code is enough.</p>
            )}
            {error && <p className="notice err" style={{ marginTop: 8 }}>{error}</p>}
            <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10, width: "100%" }}>
              {busy ? "Checking…" : "Verify & unlock my case test →"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div>
            <h3 style={{ marginTop: 0 }}>✅ Verified — you&apos;re in!</h3>
            <p className="muted" style={{ fontSize: ".88rem" }}>Your free case scenario is ready.</p>
            <a className="btn" href={`/try/cases?v=${verifId}`} style={{ width: "100%", textAlign: "center" }}>🧩 Start the case test →</a>
          </div>
        )}
      </div>
    </div>
  );
}
