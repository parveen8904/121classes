"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { capturePopupLead } from "./leadPopupActions";

// Gentle lead-capture popup on PUBLIC marketing pages only. Shows once after
// ~12s, never for logged-in users, and — once dismissed — stays away for 14
// days (forever after a successful capture). Keeps the root layout cacheable:
// the session is detected client-side.

const SHOW_ON = ["/", "/courses", "/books", "/test-series", "/placements", "/results", "/career"];
const DISMISS_KEY = "leadpop.dismissed";
const DONE_KEY = "leadpop.done";

export default function LeadPopup() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setState("busy");
    const fd = new FormData(e.currentTarget);
    fd.set("page", pathname);
    const r = await capturePopupLead(fd);
    if (!r.ok) { setError(r.error ?? "Please try again."); setState("idle"); return; }
    try { localStorage.setItem(DONE_KEY, "1"); } catch { /* private mode */ }
    setState("done");
  }

  return (
    <div
      role="dialog"
      aria-label="Get the free study planner"
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={dismiss}
    >
      <div className="form-card" style={{ maxWidth: 420, width: "100%", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={dismiss}
          aria-label="Close"
          style={{ position: "absolute", top: 8, right: 12, background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: "var(--muted)" }}
        >
          ×
        </button>
        {state === "done" ? (
          <div>
            <h3 style={{ marginTop: 0 }}>✅ You&apos;re in!</h3>
            <p className="muted" style={{ fontSize: ".9rem" }}>
              Now build your free day-by-day study plan — it takes 2 minutes.
            </p>
            <a className="btn" href="/free-planner?src=site" style={{ width: "100%", textAlign: "center" }}>📅 Build my free plan →</a>
          </div>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>📅 Get your free CA study plan</h3>
            <p className="muted" style={{ fontSize: ".86rem", marginTop: 4 }}>
              Day-by-day schedule + free chapter tests, from CA Parveen Sharma (36 years of teaching). Where should we send it?
            </p>
            <form onSubmit={onSubmit}>
              <label>Name</label>
              <input name="name" required autoComplete="name" />
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
                <div><label>WhatsApp</label><input name="phone" inputMode="numeric" autoComplete="tel" placeholder="10-digit" /></div>
                <div><label>Email</label><input name="email" type="email" autoComplete="email" /></div>
              </div>
              {error && <p className="notice err" style={{ marginTop: 8 }}>{error}</p>}
              <button className="btn" type="submit" disabled={state === "busy"} style={{ marginTop: 10, width: "100%" }}>
                {state === "busy" ? "Saving…" : "Send me the free plan →"}
              </button>
              <p className="muted" style={{ fontSize: ".72rem", marginTop: 6 }}>
                Give at least one — email or WhatsApp. No spam, and your details are never sold.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
