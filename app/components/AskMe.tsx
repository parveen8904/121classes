"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { askQuestion } from "@/app/actions/engagement";

// Floating "Ask me" button shown on every page. A student (or visitor) can ask
// a doubt or any question about the portal. Stored now; AI auto-answers later.
export default function AskMe({ signedIn }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const path = usePathname();

  function submit() {
    const fd = new FormData();
    fd.set("question", q);
    fd.set("page_path", path || "");
    if (email) fd.set("email", email);
    start(async () => {
      const r = await askQuestion(fd);
      if (r.ok) setDone(true);
    });
  }

  return (
    <>
      <button className="askme-fab" onClick={() => setOpen(true)} aria-label="Ask me a question">
        💬 Ask me
      </button>

      {open && (
        <div className="askme-overlay" onClick={() => setOpen(false)}>
          <div className="askme-card" onClick={(e) => e.stopPropagation()}>
            <button className="askme-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
            {done ? (
              <div style={{ textAlign: "center", padding: "10px 0" }}>
                <div style={{ fontSize: "2rem" }}>✅</div>
                <h3 style={{ margin: "8px 0" }}>Thank you!</h3>
                <p className="muted">Your question has been received. We&apos;ll get back to you soon.</p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: "0 0 4px" }}>Ask me anything 💬</h3>
                <p className="muted" style={{ fontSize: ".85rem", marginBottom: 12 }}>
                  A doubt about a topic, or a question about the portal — ask away.
                </p>
                <textarea
                  rows={4}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Type your question…"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
                />
                {!signedIn && (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your email (so we can reply)"
                    style={{ width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
                  />
                )}
                <button
                  className="btn block"
                  style={{ marginTop: 12 }}
                  disabled={pending || q.trim().length < 3}
                  onClick={submit}
                >
                  {pending ? "Sending…" : "Send question"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
