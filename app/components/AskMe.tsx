"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { askQuestion } from "@/app/actions/engagement";

// Floating "Ask me" button shown on every page. Answers instantly: portal
// questions (faculty, schedule, next live class, contact) from site facts, and
// CA subject doubts from the AI repository. Anything it can't answer goes to
// faculty (and the student is told).
// Build a wa.me link from a bare number or URL (assume +91 for a bare 10-digit).
function waHref(v?: string): string | null {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const d = v.replace(/\D/g, "");
  if (!d) return null;
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
}

export default function AskMe({ signedIn, facultyWhatsapp }: { signedIn?: boolean; facultyWhatsapp?: string }) {
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
      <button className="askme-fab" onClick={() => setOpen(true)} aria-label="Ask the AI a question">
        🤖 Ask AI — instant answer
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
                  <>
                    <p className="muted" style={{ lineHeight: 1.6 }}>
                      ✅ Good question! I&apos;ve sent it to CA Parveen Sharma&apos;s team and they&apos;ll get back to you{email || signedIn ? "" : " (add your email next time so we can reply)"} soon.
                    </p>
                    {/* Faculty contact appears ONLY here — when the AI couldn't answer. */}
                    {waHref(facultyWhatsapp) && (
                      <a className="btn block" href={waHref(facultyWhatsapp)!} target="_blank" rel="noopener noreferrer"
                        style={{ background: "#25D366", color: "#fff", marginTop: 10 }}>
                        💬 WhatsApp the faculty about this
                      </a>
                    )}
                  </>
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
                <h3 style={{ margin: "0 0 4px" }}>Ask me anything 💬</h3>
                <p className="muted" style={{ fontSize: ".85rem", marginBottom: 12 }}>
                  A CA doubt, or a question about the portal (faculty, classes, live sessions, fees) — ask away.
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
