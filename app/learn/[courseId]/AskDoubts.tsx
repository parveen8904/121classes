"use client";

import { useState, useTransition } from "react";
import { askSubjectDoubt } from "./doubt-actions";

function waHref(v?: string | null): string | null {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const d = v.replace(/\D/g, "");
  if (!d) return null;
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
}

// The prominent, flashing "Ask your doubts" button on each subject. AI answers
// the subject doubt instantly; if the student isn't satisfied, they can forward
// the exact question to the faculty on WhatsApp or email.
export default function AskDoubts({
  subjectId,
  subjectTitle,
  facultyPhone,
  facultyEmail,
}: {
  subjectId: string;
  subjectTitle: string;
  facultyPhone?: string | null;
  facultyEmail?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [limited, setLimited] = useState(false);
  const [pending, start] = useTransition();

  const wa = waHref(facultyPhone);

  function close() {
    setOpen(false);
    setAsked(false);
    setAnswer(null);
    setLimited(false);
    setQ("");
  }

  function submit() {
    start(async () => {
      const r = await askSubjectDoubt({ subjectId, question: q });
      setAnswer(r.ok ? r.answer : null);
      setLimited(!!r.limited);
      setAsked(true);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="askdoubts-flash"
        style={{
          border: "none",
          borderRadius: 999,
          padding: "8px 14px",
          fontWeight: 700,
          fontSize: ".85rem",
          color: "#fff",
          cursor: "pointer",
          background: "#16a34a",
        }}
      >
        💬 Ask your doubts
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 4, border: "2px solid var(--accent)", position: "relative" }}>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", fontSize: "1.3rem", lineHeight: 1, cursor: "pointer", color: "var(--muted)" }}
      >
        ×
      </button>
      {!asked ? (
        <>
          <strong>💬 Ask your doubt — {subjectTitle}</strong>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 8px" }}>
            Type your doubt for an <strong>instant reply</strong>. Not satisfied? You can send it to the faculty on WhatsApp or email.
          </p>
          <textarea
            rows={3}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. How is a current investment valued under AS 13?"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" type="button" disabled={pending || q.trim().length < 3} onClick={submit}>
              {pending ? "Thinking…" : "Get instant reply ⚡"}
            </button>
            <button className="btn secondary" type="button" onClick={close}>Close</button>
          </div>
        </>
      ) : (
        <>
          {limited ? (
            <p className="muted" style={{ marginTop: 0, marginRight: 24 }}>🙏 You&apos;ve reached today&apos;s limit of 20 questions. Continue tomorrow, or send this doubt to the faculty below.</p>
          ) : answer ? (
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: 0 }}>{answer}</p>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>I couldn&apos;t answer this from your class material — please send it to the faculty below.</p>
          )}
          <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0 6px" }}>Not satisfied? Send this doubt to the faculty:</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {wa && (
              <a className="btn small" href={`${wa}?text=${encodeURIComponent(`Doubt (${subjectTitle}): ${q}`)}`} target="_blank" rel="noopener noreferrer"
                style={{ background: "#25D366", color: "#fff" }}>
                💬 Send to faculty (WhatsApp)
              </a>
            )}
            {facultyEmail && (
              <a className="btn small secondary" href={`mailto:${facultyEmail}?subject=${encodeURIComponent(`Doubt — ${subjectTitle}`)}&body=${encodeURIComponent(q)}`}>
                ✉️ Email the faculty
              </a>
            )}
            <button className="btn small secondary" type="button" onClick={() => { setAsked(false); setAnswer(null); setQ(""); }}>
              Ask another
            </button>
          </div>
        </>
      )}
    </div>
  );
}
