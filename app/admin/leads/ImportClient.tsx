"use client";

import { useRef, useState } from "react";

// Big-file lead import. The FILE NEVER LEAVES THE BROWSER whole: we read it
// here, split it into 2,000-line batches and post them one by one, showing
// progress. That's what lets a 6-lakh-row list go in one go — a single upload
// hit the 1 MB Server Action body limit, which is why 25k chunks were needed.
const BATCH = 2000;

type Totals = { lines: number; parsed: number; added: number; duplicates: number; unusable: number };

export default function ImportClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  const [source, setSource] = useState("csv");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null); setDone(null); setPct(0);
    let text = pasted;
    const f = fileRef.current?.files?.[0];
    if (f) {
      setBusy(true); setNote(`Reading ${f.name} (${(f.size / 1048576).toFixed(1)} MB)…`);
      try { text = `${text}\n${await f.text()}`; }
      catch { setBusy(false); setNote(null); setError("Could not read that file — try saving it again as CSV."); return; }
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { setBusy(false); setNote(null); setError("Nothing to import — pick a CSV file or paste some rows."); return; }

    setBusy(true);
    const t: Totals = { lines: lines.length, parsed: 0, added: 0, duplicates: 0, unusable: 0 };
    for (let i = 0; i < lines.length; i += BATCH) {
      const slice = lines.slice(i, i + BATCH);
      setNote(`Importing ${Math.min(i + BATCH, lines.length).toLocaleString("en-IN")} of ${lines.length.toLocaleString("en-IN")} rows…`);
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const res = await fetch("/api/admin/leads-import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: slice, source }),
          });
          if (res.ok) {
            const d = await res.json();
            t.parsed += d.parsed ?? 0; t.added += d.added ?? 0;
            t.duplicates += d.duplicates ?? 0; t.unusable += d.unusable ?? 0;
            ok = true;
          } else if (res.status === 401 || res.status === 403) {
            setError("Your session expired — please refresh the page and sign in again.");
            setBusy(false); setNote(null); return;
          }
        } catch { /* network hiccup — retry */ }
        if (!ok) await new Promise((r) => setTimeout(r, 1200));
      }
      if (!ok) { setError(`Stopped at row ${i + 1}. ${t.added.toLocaleString("en-IN")} contacts were saved. Re-run with the same file — everything already saved is skipped automatically.`); break; }
      setPct(Math.round(Math.min(i + BATCH, lines.length) / lines.length * 100));
    }
    setBusy(false); setNote(null); setDone(t);
    // Refresh the page's lists/counters without losing this summary.
    setTimeout(() => { window.location.href = "/admin/leads?msg=imported"; }, 4000);
  }

  return (
    <div className="form-card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>📥 Import contacts</h3>
      <p className="muted" style={{ fontSize: ".84rem", marginTop: -4 }}>
        Any size file — lakhs of rows are fine. Columns in any order (name / phone / email);
        the same contact is never added twice.
      </p>

      <label>CSV or text file</label>
      <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" disabled={busy} />

      <label style={{ marginTop: 10 }}>…or paste rows</label>
      <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} disabled={busy}
        placeholder={"Rahul Gupta, 9876543210, rahul@example.com\nPriya, 9812345678"} />

      <div style={{ maxWidth: 240 }}>
        <label>Source label</label>
        <select value={source} onChange={(e) => setSource(e.target.value)} disabled={busy}>
          <option value="csv">CSV / spreadsheet</option>
          <option value="interakt">Interakt export</option>
          <option value="call_list">Call list</option>
          <option value="event">Seminar / event</option>
          <option value="other">Other</option>
        </select>
      </div>

      <button className="btn" type="button" onClick={run} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "⏳ Importing…" : "📥 Import contacts"}
      </button>

      {busy && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 10, borderRadius: 999, background: "var(--bg-soft)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), var(--accent-2))", transition: "width .3s" }} />
          </div>
          <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>
            {note} ({pct}%) — keep this tab open until it finishes.
          </p>
        </div>
      )}

      {error && <div className="notice err" style={{ marginTop: 12 }}>{error}</div>}

      {done && (
        <div className="notice ok" style={{ marginTop: 12 }}>
          ✅ Import finished — <strong>{done.added.toLocaleString("en-IN")} new contacts added</strong>.
          <div className="muted" style={{ fontSize: ".82rem", marginTop: 4 }}>
            {done.lines.toLocaleString("en-IN")} rows read ·{" "}
            {done.duplicates.toLocaleString("en-IN")} already in the system (skipped) ·{" "}
            {done.unusable.toLocaleString("en-IN")} had no usable phone or email.
          </div>
        </div>
      )}
    </div>
  );
}
