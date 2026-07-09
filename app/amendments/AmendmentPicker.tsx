"use client";

import { useState } from "react";

type Info = { cutoff?: string; applicable?: string; expected?: string; pdf?: string };

export default function AmendmentPicker({
  attempts,
  data,
  initial,
}: {
  attempts: string[];
  data: Record<string, Info>;
  initial: string;
}) {
  const [attempt, setAttempt] = useState(initial || attempts[0] || "");
  const info = data[attempt] || {};

  return (
    <div>
      <div className="card no-print" style={{ marginTop: 16 }}>
        <label htmlFor="attempt" style={{ fontWeight: 700 }}>Select your attempt</label>
        <select id="attempt" value={attempt} onChange={(e) => setAttempt(e.target.value)} style={{ marginTop: 6, maxWidth: 280 }}>
          {attempts.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>
          Pick a different attempt to instantly see the amendments applicable till then.
        </p>
      </div>

      <div className="card" style={{ marginTop: 14, borderColor: "var(--accent)" }}>
        <h3 style={{ margin: "0 0 4px" }}>📜 Amendments for {attempt}</h3>
        {info.cutoff && (
          <p style={{ margin: "6px 0" }}>
            🗓️ <strong>Cut-off date:</strong> {info.cutoff}{" "}
            <span className="muted">(amendments notified after this date don&apos;t apply to {attempt})</span>
          </p>
        )}
        {info.applicable && (
          <>
            <p className="muted" style={{ fontSize: ".82rem", margin: "10px 0 2px" }}>Applicable till {attempt}:</p>
            <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{info.applicable}</p>
          </>
        )}
        {info.expected && (
          <>
            <p className="muted" style={{ fontSize: ".82rem", margin: "10px 0 2px" }}>Expected before the cut-off:</p>
            <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{info.expected}</p>
          </>
        )}
        {info.pdf && (
          <a className="btn small" href={`/learn/pdf?u=${encodeURIComponent(info.pdf)}&t=Amendment PDF`} style={{ marginTop: 10, display: "inline-block" }}>
            📄 Download amendments PDF
          </a>
        )}
        {!info.cutoff && !info.applicable && !info.expected && !info.pdf && (
          <p className="muted">Details for {attempt} will be updated soon.</p>
        )}
      </div>
    </div>
  );
}
