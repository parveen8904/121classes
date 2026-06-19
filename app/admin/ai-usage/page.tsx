import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { saveAiSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI usage & cost — Admin" };

const INR = 85; // rough USD→INR for a friendly second figure

const FEATURE: Record<string, { label: string; kind: "student" | "admin" }> = {
  doubt: { label: "Ask a doubt (class / Telegram)", kind: "student" },
  ask_me: { label: "“Ask me” box", kind: "student" },
  grade: { label: "Descriptive grading", kind: "student" },
  recommend: { label: "Study recommendations", kind: "student" },
  interview: { label: "AI mock interview", kind: "student" },
  cv: { label: "CV summary polish", kind: "student" },
  suggested_answer: { label: "Suggested answer", kind: "admin" },
  generate_mcq: { label: "Generate MCQ test", kind: "admin" },
  generate_subjective: { label: "Generate descriptive test", kind: "admin" },
  other: { label: "Other", kind: "admin" },
};

const money = (usd: number) => `$${usd.toFixed(2)} · ₹${Math.round(usd * INR)}`;

export default async function AiUsagePage() {
  const svc = createServiceClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const { data: rows } = await svc
    .from("ai_usage")
    .select("feature, model, input_tokens, output_tokens, cost_usd, created_at")
    .gte("created_at", monthStart)
    .order("created_at", { ascending: false })
    .limit(20000);

  const { data: settingRows } = await svc
    .from("site_settings")
    .select("key, value")
    .in("key", ["ai_monthly_cap_usd", "ai_alert_email", "ai_doubt_daily_limit"]);
  const cfg = new Map((settingRows ?? []).map((r) => [r.key, r.value as string]));
  const cap = Number(cfg.get("ai_monthly_cap_usd")) || 0;

  const all = rows ?? [];
  let monthCost = 0, monthCalls = 0, monthIn = 0, monthOut = 0, todayCost = 0;
  const byFeature = new Map<string, { cost: number; calls: number }>();
  const byModel = new Map<string, { cost: number; calls: number }>();
  for (const r of all) {
    const cost = Number(r.cost_usd) || 0;
    monthCost += cost; monthCalls += 1;
    monthIn += r.input_tokens || 0; monthOut += r.output_tokens || 0;
    if (r.created_at >= todayStart) todayCost += cost;
    const f = byFeature.get(r.feature) ?? { cost: 0, calls: 0 };
    f.cost += cost; f.calls += 1; byFeature.set(r.feature, f);
    const m = byModel.get(r.model) ?? { cost: 0, calls: 0 };
    m.cost += cost; m.calls += 1; byModel.set(r.model, m);
  }
  const features = [...byFeature.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const models = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const monthLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const card = { background: "var(--bg-soft)", borderRadius: 10, padding: "14px 16px" } as const;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="💰 AI usage & cost"
        title="Anthropic token spend"
        subtitle="Live usage from your one Anthropic key, billed by Anthropic. Figures are estimates from token counts; your invoice in the Anthropic console is the source of truth."
        back={{ href: "/admin", label: "Admin" }}
      />

      {cap > 0 && monthCost >= cap && (
        <div style={{ marginTop: 16, background: "#fee2e2", color: "#b91c1c", padding: "12px 14px", borderRadius: 8, fontWeight: 700 }}>
          ⚠️ Over budget — this month&apos;s spend ({money(monthCost)}) has reached your cap of {money(cap)}.
        </div>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginTop: 18 }}>
        <div style={card}>
          <div className="muted" style={{ fontSize: ".8rem" }}>Today</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{money(todayCost)}</div>
        </div>
        <div style={card}>
          <div className="muted" style={{ fontSize: ".8rem" }}>{monthLabel}</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{money(monthCost)}</div>
        </div>
        <div style={card}>
          <div className="muted" style={{ fontSize: ".8rem" }}>AI calls this month</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{monthCalls.toLocaleString("en-IN")}</div>
        </div>
        <div style={card}>
          <div className="muted" style={{ fontSize: ".8rem" }}>Tokens (in / out)</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
            {(monthIn / 1000).toFixed(0)}k / {(monthOut / 1000).toFixed(0)}k
          </div>
        </div>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 28 }}>Budget &amp; limits</h2>
      <form action={saveAiSettings} className="form-card" style={{ marginTop: 8 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label>Monthly cap (USD) — 0 = off</label>
            <input name="ai_monthly_cap_usd" type="number" min={0} step={1} defaultValue={cfg.get("ai_monthly_cap_usd") ?? ""} placeholder="e.g. 50" />
          </div>
          <div>
            <label>Alert email when cap reached</label>
            <input name="ai_alert_email" type="email" defaultValue={cfg.get("ai_alert_email") ?? ""} placeholder="you@example.com" />
          </div>
          <div>
            <label>Daily AI doubts per student — 0 = unlimited</label>
            <input name="ai_doubt_daily_limit" type="number" min={0} step={1} defaultValue={cfg.get("ai_doubt_daily_limit") ?? ""} placeholder="e.g. 20" />
          </div>
        </div>
        <button className="btn" type="submit" style={{ marginTop: 10 }}>Save budget &amp; limits</button>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>
          You get one email the first time monthly spend crosses the cap. Over the daily limit, a student&apos;s doubts are still saved and answered by faculty — just not by AI.
        </p>
      </form>

      <h2 className="admin-section-title" style={{ marginTop: 28 }}>By feature — {monthLabel}</h2>
      {features.length === 0 ? (
        <div className="card"><p className="muted">No AI calls recorded yet this month.</p></div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted,#888)", borderBottom: "1px solid var(--border,#ddd)" }}>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Feature</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Type</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Calls</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {features.map(([f, v]) => {
              const meta = FEATURE[f] ?? { label: f, kind: "admin" as const };
              return (
                <tr key={f} style={{ borderBottom: "1px solid var(--border,#eee)" }}>
                  <td style={{ padding: "7px 8px" }}>{meta.label}</td>
                  <td style={{ padding: "7px 8px" }}>
                    <span style={{ fontSize: ".78rem", padding: "2px 8px", borderRadius: 999, background: meta.kind === "student" ? "rgba(13,148,136,.12)" : "var(--bg-soft)" }}>
                      {meta.kind === "student" ? "per use" : "one-time"}
                    </span>
                  </td>
                  <td style={{ padding: "7px 8px" }}>{v.calls.toLocaleString("en-IN")}</td>
                  <td style={{ padding: "7px 8px", fontWeight: 600 }}>{money(v.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {models.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 28 }}>By model</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {models.map(([m, v]) => (
              <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 8 }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: ".85rem" }}>{m}</span>
                <span><span className="muted" style={{ fontSize: ".82rem" }}>{v.calls} calls · </span><strong>{money(v.cost)}</strong></span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 20 }}>
        💡 Doubts and the “Ask me” box now run on the cheaper fast model and send only the relevant topic&apos;s material — the biggest cost levers. Test generation stays on the stronger model for quality.
      </p>
    </section>
  );
}
