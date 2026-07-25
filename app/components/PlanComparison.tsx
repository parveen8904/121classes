import { ACCESS_CATEGORIES, getAllLimits, limitFor, WATCH_CATEGORY, UNLIMITED } from "@/lib/entitlements";

// Transparent plan-by-plan comparison — what's included, what's capped and
// what's locked in Bronze (free) / Silver / Gold, straight from the SAME
// admin-managed limits matrix that actually enforces access (Admin → Access &
// limits). Rendered on /pricing and on every subject's plans page so nothing
// about the plans is ever a surprise.
const PLAN_COLS = [
  { key: "free", label: "🥉 Bronze (Free)" },
  { key: "silver", label: "🥈 Silver" },
  { key: "gold", label: "🥇 Gold" },
] as const;

function cell(lim: number): { text: string; ok: boolean } {
  if (lim === UNLIMITED || lim < 0) return { text: "✅ Unlimited", ok: true };
  if (lim === 0) return { text: "❌ Not included", ok: false };
  return { text: `✅ ${lim} included`, ok: true };
}

export default async function PlanComparison() {
  const limits = await getAllLimits();

  const rows = ACCESS_CATEGORIES.map((c) => ({
    label: c.label,
    cells: PLAN_COLS.map((p) => cell(limitFor(limits, p.key, c.key))),
  }));

  // Watch time is a multiplier, not a count.
  const watchCells = PLAN_COLS.map((p) => {
    const mult = limitFor(limits, p.key, WATCH_CATEGORY);
    return mult <= 0 || mult === UNLIMITED
      ? { text: "✅ Unlimited", ok: true }
      : { text: `${mult}× class hours`, ok: true };
  });

  const td: React.CSSProperties = { padding: "7px 10px", whiteSpace: "nowrap", fontSize: ".85rem" };

  return (
    <div style={{ margin: "8px 0 22px" }}>
      <h2 style={{ fontSize: "1.2rem", margin: "0 0 4px" }}>🔍 What&apos;s included in each plan</h2>
      <p className="muted" style={{ fontSize: ".84rem", margin: "0 0 8px" }}>
        Complete transparency — the exact same limits the system enforces, per subject.
      </p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--accent)" }}>
                <th style={{ ...td, fontWeight: 700 }}>Feature</th>
                {PLAN_COLS.map((p) => <th key={p.key} style={{ ...td, fontWeight: 700 }}>{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: "normal", minWidth: 170 }}>{r.label}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} style={{ ...td, color: c.ok ? undefined : "var(--muted)" }}>{c.text}</td>
                  ))}
                </tr>
              ))}
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: "normal", minWidth: 170 }}>⏱️ Class watch time</td>
                {watchCells.map((c, i) => <td key={i} style={td}>{c.text}</td>)}
              </tr>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: "normal", minWidth: 170 }}>🔁 Revision video watch time</td>
                <td style={td}>✅ Unlimited</td><td style={td}>✅ Unlimited</td><td style={td}>✅ Unlimited</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: "normal", minWidth: 170 }}>📄 PDF books (our notes &amp; question banks)</td>
                <td style={td}>✅ Free</td><td style={td}>✅ Free</td><td style={td}>✅ Free</td>
              </tr>
              <tr>
                <td style={{ ...td, fontWeight: 600, whiteSpace: "normal", minWidth: 170 }}>📦 FREE printed books, couriered (India)</td>
                <td style={{ ...td, color: "var(--muted)" }}>❌ Not included</td>
                <td style={{ ...td, color: "var(--muted)" }}>❌ Not included</td>
                <td style={{ ...td, fontWeight: 700, color: "#16a34a" }}>✅ On 9+ month plans</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>
        Counts are per student. &ldquo;Unlimited&rdquo; means no cap during your validity.
      </p>
    </div>
  );
}
