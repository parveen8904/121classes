import { formatMonth } from "@/lib/dates";
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
  const monthLabel = formatMonth(now);

  // --- AI (exact, from our log) ---
  // Aggregated in the database — see ai_spend_since. Fetching the rows to add
  // them up here was truncated at 1,000 by PostgREST, so this figure stopped
  // moving once the month passed a thousand AI calls.
  const { data: aiRows } = await svc.rpc("ai_spend_since", { period_start: monthStart });
  const aiMonth = ((aiRows ?? []) as { cost_usd: number | string }[])
    .reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

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
  const { data: costCfg } = await svc.from("site_settings").select("key, value").in("key", ["bunny_cap_usd", "supabase_storage_cap_mb", "cost_alert_email", "supabase_plan_usd", "vercel_plan_usd", "cloudflare_bill_usd", "bunny_bill_usd"]);
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
  const cloudflareBill = cfg.get("cloudflare_bill_usd") != null ? Number(cfg.get("cloudflare_bill_usd")) : 0;
  // Bunny live from its API if the account key is set; otherwise the real
  // figure entered from the dashboard (dash.bunny.net → Account → Billing).
  const bunnyManual = cfg.get("bunny_bill_usd") != null ? Number(cfg.get("bunny_bill_usd")) : 0;
  const bunnyMonth = bunnyBill?.thisMonth ?? bunnyManual;
  const totalMonth = aiMonth + bunnyMonth + supabasePlan + vercelPlan + cloudflareBill;

  // --- Payment history: what each provider has actually taken, month by month.
  // Written by the monthly cron (/api/cron/costs-snapshot); seeded with the real
  // invoices read on 20 Aug 2026. Answers "how much have they already taken?".
  const { data: histRows } = await svc
    .from("cost_history")
    .select("month, provider, amount_usd, source")
    .order("month", { ascending: false });
  type Hist = { month: string; provider: string; amount_usd: number | string; source: string };
  const hist = (histRows ?? []) as Hist[];
  const PROVIDERS = ["ai", "bunny", "supabase", "vercel", "cloudflare"] as const;
  const provLabel: Record<string, string> = { ai: "AI", bunny: "Bunny", supabase: "Supabase", vercel: "Vercel", cloudflare: "Cloudflare" };
  const months = [...new Set(hist.map((h) => h.month))].sort().reverse();
  const cell = new Map<string, number>();
  for (const h of hist) cell.set(`${h.month}|${h.provider}`, Number(h.amount_usd) || 0);
  const provTotal = (p: string) => hist.filter((h) => h.provider === p).reduce((s, h) => s + (Number(h.amount_usd) || 0), 0);
  const grandTotal = hist.reduce((s, h) => s + (Number(h.amount_usd) || 0), 0);
  const monthTotal = (m: string) => PROVIDERS.reduce((s, p) => s + (cell.get(`${m}|${p}`) ?? 0), 0);

  // --- Bunny videos vs YouTube (usage proxy) ---
  const { data: secs } = await svc.from("sections_meta").select("bunny_video_id, youtube_url").limit(5000);
  let bunnyVideos = 0, youtubeVideos = 0;
  for (const s of (secs ?? []) as { bunny_video_id: string | null; youtube_url: string | null }[]) {
    if (s.bunny_video_id) bunnyVideos++;
    else if (s.youtube_url) youtubeVideos++;
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
        subtitle="AI and Bunny are MEASURED live. Supabase, Vercel and Cloudflare show the LATEST REAL BILLS, entered below — synced from the providers' own invoices on 20 Aug 2026; update them when a new invoice lands."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Total this month */}
      <div style={{ marginTop: 18, background: "linear-gradient(135deg,#0d9488,#10b981)", color: "#fff", borderRadius: 14, padding: "18px 20px" }}>
        <div style={{ fontSize: ".85rem", opacity: 0.92 }}>Estimated total for {monthLabel}</div>
        <div style={{ fontSize: "2rem", fontWeight: 800, margin: "4px 0" }}>{money(totalMonth)}</div>
        <div style={{ fontSize: ".8rem", opacity: 0.92 }}>
          AI {money(aiMonth)} (exact) · Bunny {money(bunnyMonth)} {bunnyBill ? "(live)" : "(entered)"} · Supabase {money(supabasePlan)} · Vercel {money(vercelPlan)} · Cloudflare {money(cloudflareBill)} — <strong>all real figures; add the Bunny account key to make Bunny live too</strong>
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
          <div style={stat}>{money(supabasePlan)}<span className="muted" style={{ fontSize: ".8rem", fontWeight: 400 }}>/mo latest invoice</span></div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>
            NOT flat $25. The Aug invoice is ~$42: $25 Pro base + ~$17 compute, because <strong>four projects share this one billing org</strong> — 121classes-mumbai ($9.89, this website), plus control-erp, valuation-platform and Microradar. Only the first counts as the site; the other three are your separate projects. To cut it: pause or downsize the projects you are not using. {storageFiles >= 0 ? `Site storage now: ${storageFiles} files · ${mb(storageBytes)}.` : ""} Real total entered below.
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
          <div style={stat}>{money(vercelPlan)}<span className="muted" style={{ fontSize: ".8rem", fontWeight: 400 }}>/mo latest invoice</span></div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>$20 Pro base + on-demand usage. The Aug bill&apos;s biggest overage line is <strong>Observability Events ($11.20)</strong> — the &quot;Observability Plus&quot; add-on; turn it off in Vercel → Settings → Observability if you don&apos;t use the dashboard and the bill drops to roughly $19. Cap the rest in Settings → Billing → Spend Management.</p>
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
              <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 6px" }}>Used this month · {bunnyVideos} videos ({youtubeVideos} on free YouTube).</p>
              <div style={{ fontWeight: 700, fontSize: ".9rem", color: bunnyBill.balance < 5 ? "#b91c1c" : "#16a34a" }}>
                💳 Credits left: {money(bunnyBill.balance)}{bunnyBill.balance < 5 ? " — running low, top up soon" : ""}
              </div>
            </>
          ) : (
            <>
              <div style={stat}>{money(bunnyManual)}<span className="muted" style={{ fontSize: ".8rem", fontWeight: 400 }}>/mo latest usage</span></div>
              <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>YOUR BIGGEST CLOUD BILL, and it is <strong>storage, not video streaming</strong> — Aug $88 was Storage ~$80 + CDN ~$3; July was $121. {bunnyVideos} videos on Bunny ({youtubeVideos} on free YouTube). To cut it: the Bunny <em>storage zone</em> replicates every file across regions — drop unused regions, and delete class recordings/originals you no longer serve. Add the Bunny <strong>Account API key</strong> in Integrations to make this live.</p>
            </>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <a className="btn small" href="/admin/bunny">Why is it this much?</a>
            <a className="btn small secondary" href="https://dash.bunny.net/billing" target="_blank" rel="noopener noreferrer">View Bunny bill ↗</a>
          </div>
        </div>

        {/* Cloudflare R2 */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>☁️ Cloudflare R2 (large files)</strong>
            <span className="badge" style={{ color: r2On ? "#16a34a" : "var(--muted)", borderColor: r2On ? "#16a34a" : "var(--border)" }}>{r2On ? "connected" : "not set"}</span>
          </div>
          <div style={stat}>{r2Files} files</div>
          <div style={stat}>{money(cloudflareBill)}<span className="muted" style={{ fontSize: ".8rem", fontWeight: 400 }}>/mo latest bill</span></div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>Was free while the store was under 10 GB; it now holds ~25 GB (installers, papers, backups), so ~15 GB bills at $0.015/GB-month → about $8/mo. Egress stays free. To stop it rising: delete old desktop-app installers and stale backups you no longer keep on R2. Update the figure below when an invoice lands.</p>
          <a className="btn small secondary" href="https://dash.cloudflare.com/?to=/:account/r2/overview" target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>View R2 usage ↗</a>
        </div>

      </div>

      {/* Payment history — what they've actually taken, month by month */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }}>🧾 What they&apos;ve taken so far</h2>
      <p className="muted" style={{ fontSize: ".84rem", marginTop: 4 }}>
        A running ledger — one row per month, filled automatically on the 1st. AI and Bunny are measured; Vercel, Supabase and Cloudflare freeze the real-invoice figures from the box below (those three have no billing API to read). <strong>Total taken to date: {money(grandTotal)}</strong>.
      </p>
      {months.length === 0 ? (
        <div style={card}><p className="muted" style={{ margin: 0 }}>No history yet — the first monthly snapshot writes on the 1st.</p></div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".86rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Month</th>
                {PROVIDERS.map((p) => <th key={p} style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{provLabel[p]}</th>)}
                <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m}>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--border)" }}>{formatMonth(new Date(m))}</td>
                  {PROVIDERS.map((p) => {
                    const v = cell.get(`${m}|${p}`);
                    return <td key={p} style={{ textAlign: "right", padding: "6px 8px", borderBottom: "0.5px solid var(--border)", color: v == null ? "var(--muted)" : "inherit" }}>{v == null ? "—" : `$${v.toFixed(2)}`}</td>;
                  })}
                  <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "0.5px solid var(--border)", fontWeight: 700 }}>${monthTotal(m).toFixed(2)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: "8px", fontWeight: 800 }}>Total taken</td>
                {PROVIDERS.map((p) => <td key={p} style={{ textAlign: "right", padding: "8px", fontWeight: 700 }}>${provTotal(p).toFixed(2)}</td>)}
                <td style={{ textAlign: "right", padding: "8px", fontWeight: 800 }}>${grandTotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

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
            <label>Supabase — latest invoice (USD)</label>
            <input name="supabase_plan_usd" type="number" min={0} step={0.01} defaultValue={cfg.get("supabase_plan_usd") ?? "25"} placeholder="25" />
          </div>
          <div>
            <label>Vercel — latest invoice (USD)</label>
            <input name="vercel_plan_usd" type="number" min={0} step={0.01} defaultValue={cfg.get("vercel_plan_usd") ?? "20"} placeholder="30.58" />
          </div>
          <div>
            <label>Cloudflare — latest invoice (USD)</label>
            <input name="cloudflare_bill_usd" type="number" min={0} step={0.01} defaultValue={cfg.get("cloudflare_bill_usd") ?? "0"} placeholder="8.12" />
          </div>
          <div>
            <label>Bunny — latest usage (USD) — used until the API key is added</label>
            <input name="bunny_bill_usd" type="number" min={0} step={0.01} defaultValue={cfg.get("bunny_bill_usd") ?? "0"} placeholder="88.03" />
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
