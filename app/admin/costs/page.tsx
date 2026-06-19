import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costs & usage — Admin" };

const INR = 85;
const money = (usd: number) => `$${usd.toFixed(2)} · ₹${Math.round(usd * INR)}`;
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const PROJECT = "ydpkcmyjkekvfwnnvphn";

export default async function CostsPage() {
  const svc = createServiceClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // --- AI (exact, from our log) ---
  const { data: aiRows } = await svc.from("ai_usage").select("cost_usd").gte("created_at", monthStart).limit(20000);
  const aiMonth = (aiRows ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

  // --- Supabase storage used (sum of object sizes) ---
  let storageBytes = -1, storageFiles = -1;
  try {
    const { data: objs } = await svc.schema("storage").from("objects").select("metadata").limit(10000);
    if (objs) {
      storageFiles = objs.length;
      storageBytes = objs.reduce((s, o) => s + (Number((o.metadata as { size?: number } | null)?.size) || 0), 0);
    }
  } catch {
    /* storage schema not queryable — show link instead */
  }

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
          </div>
          <div style={stat}>{storageBytes >= 0 ? mb(storageBytes) : "—"}</div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>
            {storageFiles >= 0 ? `${storageFiles} files stored · ` : ""}Free tier: 1 GB files, 500 MB database, 5 GB transfer/mo.
          </p>
          <a className="btn small secondary" href={`https://supabase.com/dashboard/project/${PROJECT}/settings/billing`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>View usage &amp; bill ↗</a>
        </div>

        {/* Bunny */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>🎬 Bunny (video)</strong>
            <span className="badge" style={{ color: bunnyOn ? "#16a34a" : "var(--muted)", borderColor: bunnyOn ? "#16a34a" : "var(--border)" }}>{bunnyOn ? "connected" : "not set"}</span>
          </div>
          <div style={stat}>{bunnyVideos} videos</div>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>Classes on Bunny ({youtubeVideos} on free YouTube). Bunny bills for storage + streaming — exact ₹ is on Bunny.</p>
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

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 18 }}>
        💡 Want live ₹ figures for Bunny / Cloudflare / Supabase pulled into this page automatically? That needs each provider&apos;s billing API token — tell me and I&apos;ll wire it up. The AI monthly cap &amp; alert are set in <Link href="/admin/ai-usage" style={{ color: "var(--accent)" }}>AI usage</Link>.
      </p>
    </section>
  );
}
