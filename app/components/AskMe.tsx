"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { askQuestion } from "@/app/actions/engagement";
import { useSignedIn } from "./AuthCta";

// Floating "Ask me" button shown on every page. Answers instantly: portal
// questions (faculty, schedule, next live class, contact) from site facts, and
// CA subject doubts from the AI repository. Anything it can't answer goes to
// faculty (and the student is told).
// Detects the session in the browser (no server prop) so the root layout doesn't
// have to read cookies — which would force the whole site to render dynamically.
export default function AskMe() {
  const signedIn = useSignedIn(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [pending, start] = useTransition();
  const path = usePathname();

  function submit() {
    const fd = new FormData();
    fd.set("question", q);
    fd.set("page_path", path || "");
    if (email) fd.set("email", email);
    start(async () => {
      const r = await askQuestion(fd);
      if (r.ok) {
        setAnswer(r.answer ?? null);
        setEscalated(!r.answer);
      }
    });
  }

  function reset() {
    setAnswer(null);
    setEscalated(false);
    setQ("");
  }

  const answered = answer !== null || escalated;

  return (
    <>
      <button className="askme-fab" onClick={() => setOpen(true)} aria-label="Ask me">
        💬 Ask me
      </button>

      {open && (
        <div className="askme-overlay" onClick={() => setOpen(false)}>
          <div className="askme-card" onClick={(e) => e.stopPropagation()}>
            <button className="askme-x" onClick={() => { setOpen(false); reset(); }} aria-label="Close">×</button>

            {answered ? (
              <div>
                <h3 style={{ margin: "0 0 10px" }}>💬 Answer</h3>
                {answer ? (
                  <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{answer}</p>
                ) : (
                  <p className="muted" style={{ lineHeight: 1.6 }}>
                    ✅ Got it! I&apos;ve sent your query to the team and they&apos;ll get back to you{email || signedIn ? "" : " (add your email next time so we can reply)"} soon.
                  </p>
                )}
                <p className="muted" style={{ fontSize: ".75rem", marginTop: 12 }}>
                  AI assistant · guided by CA Parveen Sharma&apos;s team. Double-check anything important.
                </p>
                <button className="btn block secondary" style={{ marginTop: 12 }} onClick={reset}>
                  Ask another question
                </button>
              </div>
            ) : (
              <>
                <h3 style={{ margin: "0 0 4px" }}>💬 Ask me</h3>
                <p className="muted" style={{ fontSize: ".85rem", marginBottom: 12 }}>
                  Questions about the website or portal — courses, plans, live sessions, login or any technical issue.
                  <br />For a <strong>CA subject doubt</strong>, use the <strong>“Ask your doubts”</strong> button on your subject page.
                </p>
                <textarea
                  rows={4}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="e.g. When is the next live class? / Explain IND AS 115 revenue recognition."
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {[
                    "When is the next live class?",
                    "Who are the faculty?",
                    "What courses do you offer?",
                    "How do I download a class?",
                  ].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setQ(s)}
                      style={{
                        border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)",
                        borderRadius: 999, padding: "5px 11px", fontSize: ".78rem", cursor: "pointer",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {!signedIn && (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your email (so we can reply if needed)"
                    style={{ width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
                  />
                )}
                <button
                  className="btn block"
                  style={{ marginTop: 12 }}
                  disabled={pending || q.trim().length < 3}
                  onClick={submit}
                >
                  {pending ? "Thinking…" : "Ask"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
