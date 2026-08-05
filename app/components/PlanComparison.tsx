import { ACCESS_CATEGORIES, getAllLimits, limitFor, isDaily, WATCH_CATEGORY, UNLIMITED } from "@/lib/entitlements";

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

// Colour language: GREEN only for truly unlimited; AMBER for a capped count
// (so the differences between plans jump out); muted for locked.
const GREEN = "#16a34a";
const AMBER = "#b45309";
function cell(lim: number, category: string): { text: string; color?: string; bold?: boolean } {
  if (lim === UNLIMITED || lim < 0) return { text: "✅ Unlimited", color: GREEN, bold: true };
  if (lim === 0) return { text: "❌ Not included", color: "var(--muted)" };
  // A daily allowance has to SAY it is daily, or "5 included" reads as five in
  // total and a student thinks they have run out for good.
  if (isDaily(category)) return { text: `${lim} a day`, color: AMBER, bold: true };
  return { text: `${lim} included`, color: AMBER, bold: true };
}

export default async function PlanComparison() {
  const limits = await getAllLimits();

  // A comparison table earns its place by showing DIFFERENCES. Two things were
  // in it that are not differences, and one the founder does not want quoted at
  // all:
  //
  //   • doubts — the daily allowance is explained where a student actually asks
  //     one, and putting a number on the plan page turns a generous feature
  //     into a quota being counted at them;
  //   • watch time — 2x class hours on Bronze, Silver AND Gold, so a column of
  //     three identical cells taught nobody anything;
  //   • revision videos — unlimited on every plan, same problem.
  //
  // The two watch rules are true and worth saying, so they moved to the note
  // under the table where a common rule belongs.
  const HIDE_FROM_TABLE = new Set(["ask_query"]);

  // Doubts are five a day on every plan, so like watch time this is a fact
  // about the service rather than a difference between plans. Read from the
  // limits table so the sentence cannot drift from what is enforced, and it
  // falls back to naming each plan if they are ever made to differ.
  const askLimits = PLAN_COLS.map((p) => limitFor(limits, p.key, "ask_query"));
  const askSame = askLimits.every((n) => n === askLimits[0]);
  const askNote = askSame
    ? askLimits[0] === UNLIMITED || askLimits[0] < 0
      ? "as many doubts as you like"
      : `${askLimits[0]} doubts a day`
    : askLimits.map((n) => (n < 0 ? "unlimited" : `${n}`)).join(" / ") + " a day on Bronze / Silver / Gold";

  const rows = ACCESS_CATEGORIES.filter((c) => !HIDE_FROM_TABLE.has(c.key)).map((c) => ({
    label: c.label,
    cells: PLAN_COLS.map((p) => cell(limitFor(limits, p.key, c.key), c.key)),
  }));

  // Watch time is a multiplier, and it is the SAME on every plan — so it is
  // stated once, below the table, instead of as three identical columns.
  const multipliers = PLAN_COLS.map((p) => limitFor(limits, p.key, WATCH_CATEGORY));
  const same = multipliers.every((m) => m === multipliers[0]);
  const watchNote = !same
    ? `${multipliers.map((m) => (m <= 0 || m === UNLIMITED ? "unlimited" : `${m}×`)).join(" / ")} on Bronze / Silver / Gold`
    : multipliers[0] <= 0 || multipliers[0] === UNLIMITED
      ? "as many times as you like"
      : `${multipliers[0]}×`;

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
                    <td key={i} style={{ ...td, color: c.color, fontWeight: c.bold ? 700 : undefined }}>{c.text}</td>
                  ))}
                </tr>
              ))}
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
      <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0", lineHeight: 1.7 }}>
        <strong>The same on every plan:</strong> 💬 you can ask <strong>{askNote}</strong> — the allowance
        refills every morning, so it is not a pot to save up and an unused day does not carry forward.
        {" "}⏱️ each class can be watched up to{" "}
        <strong>{watchNote}</strong> its length, which is there only to stop an account being shared —
        it is far more than anyone needs to learn from a class. 🔁 <strong>Revision videos have no watch
        limit at all</strong> and stay open until your validity ends.
      </p>
      <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>
        Counts are per student. &ldquo;Unlimited&rdquo; means no cap during your validity. Everything here
        works while your plan is valid; once validity ends, access stops.
      </p>
    </div>
  );
}
