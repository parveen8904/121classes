import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { getBunnyBilling } from "@/lib/bunny";
import SubmitButton from "@/app/components/SubmitButton";
import { saveCostSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costs & usage — Admin" };

const INR = 85;
const money = (usd: number) => `$${usd.toFixed(2)} · ₹${Math.round(usd * INR)}`;
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// Live project (Mumbai) + the org that holds the Pro billing.
const SUPABASE_PROJECT = "xmeltwyfvzhhurtcjfiu";
const SUPABASE_ORG = "rnrmaxczwrbrcxoqimaa";

export default async function CostsPage() {
  const svc = createServiceClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // --- AI (exact, from our log) ---
  const { data: aiRows } = await svc.from("ai_usage").select("cost_usd").gte("created_at", monthStart).limit(20000);
  const aiMonth = (aiRows ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

  // --- Supabase storage used (reliable, via SECURITY DEFINER function) ---
  let storageBytes = -1, storageFiles = -1;
  try {
    const { data: u } = await svc.rpc("storage_usage");
    const row = Array.isArray(u) ? u[0] : u;
    if (row) { storageFiles = Number(row.files) || 0; storageBytes = Number(row.bytes) || 0; }
  } catch {
    /* show link instead */
  }

  // --- Bunny live billing (this month's charges) + cap settings ---
  const bunnyBill = await getBunnyBilling();
  const { data: costCfg } = await svc.from("site_settings").select("key, value").in("key", ["bunny_cap_usd", "supabase_storage_cap_mb", "cost_alert_email", "supabase_plan_usd", "vercel_plan_usd"]);
  const cfg = new Map((costCfg ?? []).map((r) => [r.key, r.value as string]));
  const bunnyCap = Number(cfg.get("bunny_cap_usd")) || 0;
  const bunnyOver = bunnyBill && bunnyCap > 0 && bunnyBill.thisMonth >= bunnyCap;
  const storageCapMb = Number(cfg.get("supabase_storage_cap_mb")) || 0;
  const storageMbVal = storageBytes >= 0 ? storageBytes / (1024 * 1024) : 0;
  const storageOver = storageCapMb > 0 && storageBytes >= 0 && storageMbVal >= storageCapMb;

  // Flat monthly plan bases (Supabase + Vercel don't expose a live-cost API, but
  // with spend caps on these are effectively fixed). Editable below; defaults
  // match the founder's current plans.
  const supabasePlan = cfg.get("supabase_plan_usd") != null ? Number(cfg.get("supabase_plan_usd")) : 25;
  const vercelPlan = cfg.get("vercel_plan_usd") != null ? Number(cfg.get("vercel_plan_usd")) : 20;
  const bunnyMonth = bunnyBill?.thisMonth ?? 0;
  const totalMonth = aiMonth + bunnyMonth + supabasePlan + vercelPlan;

  // --- Bunny videos vs YouTube (usage proxy) ---
  const { data: secs } = await svc.from("sections").select("config").limit(5000);
  let bunnyVideos = 0, youtubeVideos = 0;
  for (const s of secs ?? []) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    if (c.bunny_video_id) bunnyVideos++;
    else if (c.youtube_url) youtubeVideos++;
  }

  // --- Files on R2 vs Supabase (by URL) ---
  const { data: repo } = await svc.from("repository_items").select("file_url").not("file_url", "is", null).limit(5000);
  let r2Files = 0;
  for (const r of repo ?? []) if (/r2\.dev|r2\.cloudflarestorage/.test(String(r.file_url))) r2Files++;
  const r2On = !!(await getSecret("R2_ACCOUNT_ID")) && !!(await getSecret("R2_BUCKET"));
  const bunnyOn = !!(await getSecret("BUNNY_STREAM_API_KEY"));

  const card: React.CSSProperties = { background: "var(--color-background-primary, #fff)", border: "0.5px solid var(--border,#e5e5e5)", borderRadius: 12, padding: "16px 18px" };
  const stat: React.CSSProperties = { fontSize: "1.5rem", fontWeight: 700, margin: "4px 0" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="💰 Costs & usage"
        title="What each service is costing you"
        subtitle="AI is tracked exactly here. For Bunny, Cloudflare & Supabase, see the usage we can measure plus a one-tap link to the provider's own bill."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Total this month */}
      <div style={{ marginTop: 18, background: "linear-gradient(135deg,#0d9488,#10b981)", color: "#fff", borderRadius: 14, padding: "18px 20px" }}>
        <div style={{ fontSize: ".85rem", opacity: 0.92 }}>Estimated total for {monthLabel}</div>
        <div style={{ fontSize: "2rem", fontWeight: 800, margin: "4px 0" }}>{money(totalMonth)}</div>
        <div style={{ fontSize: ".8rem", opacity: 0.92 }}>
          AI {money(aiMonth)} (exact) · Bunny {money(bunnyMonth)} (live) · Supabase {money(supabasePlan)} + Vercel {money(vercelPlan)} (plan base) · R2 free
        </div>
      </div>

      {bunnyOver && (
        <div style={{ marginTop: 16, background: "#fee2e2", color: "#b91c1c", padding: "12px 14px", borderRadius: 8, fontWeight: 700 }}>
          ⚠️ Bunny video cost this month ({money(bunnyBill!.thisMonth)}) has reached your cap of {money(bunnyCap)}.
        </div>
      )}
      {storageOver && (
        <div style={{ marginTop: 16, background: "#fee2e2", color: "#b91c1c", padding: "12px 14px", borderRadius: 8, fontWeight: 700 }}>
          ⚠️ Supabase storage ({storageMbVal.toFixed(0)} MB) has reached your cap of {storageCapMb} MB. Enable Cloudflare R2 for large files.
        </div>
      )}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", marginTop: 20 }}>

        {/* AI */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>🤖 AI (Anthropic)</strong>
            <span className="badge" style={{ color: "#16a34a", borderColor: "#16a34a" }}>tracked exactly</span>
          </div>
          <div style={stat}>{money(aiMonth)}</div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>Spent in {monthLabel} (doubts, tests, grading…)</p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <Link className="btn small secondary" href="/admin/ai-usage">Breakdown →</Link>
            <a className="btn small secondary" href="https://console.anthropic.com/settings/usage" target="_blank" rel="noopener noreferrer">View bill ↗</a>
          </div>
        </div>

        {/* Supabase */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>🗄️ Supabase (database + files)</strong>
            <span className="badge">Pro · plan base</span>
          </div>
          <div style={stat}>{money(supabasePlan)}</div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>
            Flat with spend cap on. {storageFiles >= 0 ? `${storageFiles} files · ${mb(storageBytes)} stored.` : ""} No public live-cost API — see bill for exact.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <a className="btn small secondary" href={`https://supabase.com/dashboard/org/${SUPABASE_ORG}/billing`} target="_blank" rel="noopener noreferrer">View bill ↗</a>
            <a className="btn small secondary" href={`https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/reports/database`} target="_blank" rel="noopener noreferrer">Usage ↗</a>
          </div>
        </div>

        {/* Vercel */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>▲ Vercel (hosting)</strong>
            <span className="badge">Pro · plan base</span>
          </div>
          <div style={stat}>{money(vercelPlan)}</div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>Flat Pro base. Set a spending limit in Vercel → Settings → Billing. No public live-cost API — see bill for exact.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <a className="btn small secondary" href="https://vercel.com/dashboard/usage" target="_blank" rel="noopener noreferrer">Usage ↗</a>
            <a className="btn small secondary" href="https://vercel.com/account/billing" target="_blank" rel="noopener noreferrer">Billing ↗</a>
          </div>
        </div>

        {/* Bunny */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>🎬 Bunny (video)</strong>
            <span className="badge" style={{ color: bunnyOn ? "#16a34a" : "var(--muted)", borderColor: bunnyOn ? "#16a34a" : "var(--border)" }}>{bunnyOn ? "connected" : "not set"}</span>
          </div>
          {bunnyBill ? (
            <>
              <div style={stat}>{money(bunnyBill.thisMonth)}</div>
              <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>This month&apos;s Bunny charges · balance {money(bunnyBill.balance)} · {bunnyVideos} videos ({youtubeVideos} on free YouTube).</p>
            </>
          ) : (
            <>
              <div style={stat}>{bunnyVideos} videos</div>
              <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>Classes on Bunny ({youtubeVideos} on free YouTube). Add your Bunny <strong>Account API key</strong> in Integrations to show live ₹ charges here.</p>
            </>
          )}
          <a className="btn small secondary" href="https://dash.bunny.net/billing" target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>View Bunny bill ↗</a>
        </div>

        {/* Cloudflare R2 */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>☁️ Cloudflare R2 (large files)</strong>
            <span className="badge" style={{ color: r2On ? "#16a34a" : "var(--muted)", borderColor: r2On ? "#16a34a" : "var(--border)" }}>{r2On ? "connected" : "not set"}</span>
          </div>
          <div style={stat}>{r2Files} files</div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>Free up to 10 GB storage + free egress. Exact usage is on Cloudflare.</p>
          <a className="btn small secondary" href="https://dash.cloudflare.com/?to=/:account/r2/overview" target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>View R2 usage ↗</a>
        </div>

      </div>

      {/* Budget caps + alerts */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }}>🔔 Budget alerts</h2>
      <form action={saveCostSettings} className="form-card" style={{ marginTop: 8 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label>Bunny monthly cap (USD) — 0 = off</label>
            <input name="bunny_cap_usd" type="number" min={0} step={1} defaultValue={cfg.get("bunny_cap_usd") ?? ""} placeholder="e.g. 20" />
          </div>
          <div>
            <label>Supabase storage cap (MB) — 0 = off</label>
            <input name="supabase_storage_cap_mb" type="number" min={0} step={50} defaultValue={cfg.get("supabase_storage_cap_mb") ?? ""} placeholder="e.g. 900" />
          </div>
          <div>
            <label>Alert email</label>
            <input name="cost_alert_email" type="email" defaultValue={cfg.get("cost_alert_email") ?? ""} placeholder="you@example.com" />
          </div>
          <div>
            <label>Supabase plan (USD/mo)</label>
            <input name="supabase_plan_usd" type="number" min={0} step={1} defaultValue={cfg.get("supabase_plan_usd") ?? "25"} placeholder="25" />
          </div>
          <div>
            <label>Vercel plan (USD/mo)</label>
            <input name="vercel_plan_usd" type="number" min={0} step={1} defaultValue={cfg.get("vercel_plan_usd") ?? "20"} placeholder="20" />
          </div>
        </div>
        <SubmitButton className="btn" style={{ marginTop: 10 }}>Save budget alerts</SubmitButton>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>
          One email the first time each crosses its cap (checked daily). Bunny needs the Account API key in Integrations. AI has its own cap in <Link href="/admin/ai-usage" style={{ color: "var(--accent)" }}>AI usage</Link>. Cloudflare R2 is free to 10 GB — watched on Cloudflare.
        </p>
      </form>

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 18 }}>
        💡 Want live ₹ figures for Bunny / Cloudflare / Supabase pulled into this page automatically? That needs each provider&apos;s billing API token — tell me and I&apos;ll wire it up. The AI monthly cap &amp; alert are set in <Link href="/admin/ai-usage" style={{ color: "var(--accent)" }}>AI usage</Link>.
      </p>
    </section>
  );
}
