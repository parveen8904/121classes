import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { saveHomepageVideos } from "./actions";
import { getChannelOverview } from "@/lib/youtubeStats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing overview — Admin" };

type Report = {
  leads_total: number; leads_week: number; leads_verified: number;
  leads_by_source: { source: string; c: number }[];
  signups_week: number; signups_month: number;
  signups_by_heard: { heard: string; c: number }[];
  visits_week: number; visits_month: number;
  traffic_by_src: { src: string; c: number }[];
  campaigns_pending: number; campaigns_sent_month: number;
};

const SRC_LABEL: Record<string, string> = {
  yt: "▶️ YouTube", wa: "💬 WhatsApp", ig: "📷 Instagram", tg: "✈️ Telegram",
  site: "🌐 Site popup", article: "📝 Articles", articles: "📝 Articles", try: "🧩 Case test",
  trycase: "🧩 Case test", metaads: "💰 Meta ads", googleads: "💰 Google ads", call: "📞 Missed-call",
};
const HEARD_LABEL: Record<string, string> = {
  youtube: "▶️ YouTube", telegram: "✈️ Telegram", friend: "🤝 Friend", google: "🔍 Google",
  instagram: "📷 Instagram", whatsapp: "💬 WhatsApp", attended_before: "🎓 Past student", other: "Other",
};

function Bars({ rows, label }: { rows: { k: string; c: number }[]; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.c));
  if (rows.length === 0) return <p className="muted" style={{ fontSize: ".85rem" }}>No data yet.</p>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 130, fontSize: ".82rem" }}>{label(r.k)}</span>
          <div style={{ flex: 1, background: "var(--bg-soft)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${(r.c / max) * 100}%`, minWidth: 2, height: 16, background: "linear-gradient(90deg,#0d9488,#10b981)" }} />
          </div>
          <strong style={{ width: 40, textAlign: "right", fontSize: ".85rem" }}>{r.c}</strong>
        </div>
      ))}
    </div>
  );
}

export default async function MarketingOverviewPage() {
  const svc = createServiceClient();
  const { data } = await svc.rpc("admin_marketing_report");
  const r = (data ?? {}) as Report;

  // Instagram auto-posting status + recent activity.
  const { igConfigured } = await import("@/lib/instagram");
  const igOn = await igConfigured();
  const { count: igPosts30 } = await svc
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("to_instagram", true)
    .eq("status", "sent")
    .gte("sent_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
  const { count: igQueued } = await svc
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("to_instagram", true)
    .eq("status", "pending");
  const yt = await getChannelOverview().catch(() => null);

  // All recent channel videos + the admin's current homepage selection.
  const { getRecentVideos } = await import("@/lib/youtubeStats");
  const allVideos = yt?.uploadsPlaylist ? await getRecentVideos(yt.uploadsPlaylist, 24).catch(() => []) : [];
  const { data: selRow } = await svc.from("site_settings").select("value").eq("key", "homepage_yt_videos").maybeSingle();
  let selectedIds: string[] = [];
  try { selectedIds = (JSON.parse((selRow?.value as string) || "[]") as { id: string }[]).map((v) => v.id); } catch { /* fresh */ }

  // Funnel conversion (30 days).
  const visitToLead = r.visits_month ? ((r.leads_total ? r.leads_week : 0) / r.visits_week * 100) : 0;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📊 Marketing overview"
        title="Marketing at a glance"
        subtitle="Every number that matters in one place — leads, signups, and which platform actually brings students. Check it once a week. 📈"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Homepage YouTube curation — the homepage shows ONLY what's ticked here. */}
      <h2 className="admin-section-title" style={{ marginTop: 20 }}>🎬 Homepage YouTube videos</h2>
      <div className="card" style={{ marginTop: 10 }}>
        <p className="muted" style={{ fontSize: ".84rem", marginTop: 0 }}>
          Tick <strong>up to 3</strong> videos — only these appear on the homepage (no view counts shown).
          If none are ticked, the latest 3 from the channel show automatically. Ticking more than 3 keeps the first 3.
        </p>
        {allVideos.length > 0 ? (
          <form action={saveHomepageVideos}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
              {allVideos.map((v) => (
                <label key={v.id} style={{ border: selectedIds.includes(v.id) ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 10, overflow: "hidden", cursor: "pointer", display: "block" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt={v.title} loading="lazy" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px" }}>
                    <input type="checkbox" name="vid" value={`${v.id}:::${v.title}`} defaultChecked={selectedIds.includes(v.id)} style={{ marginTop: 2 }} />
                    <span style={{ fontSize: ".8rem", fontWeight: 600, lineHeight: 1.25 }}>{v.title}</span>
                  </div>
                </label>
              ))}
            </div>
            <SubmitButton className="btn" savedLabel="✓ Homepage videos updated" style={{ marginTop: 12 }}>
              Save homepage videos
            </SubmitButton>
          </form>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Couldn&apos;t load the channel&apos;s videos right now — refresh in a minute.</p>
        )}
      </div>

      {/* Funnel */}
      <h2 className="admin-section-title" style={{ marginTop: 20 }}>🔽 This week's funnel</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <div className="card" style={{ padding: "12px 18px" }}><div className="muted" style={{ fontSize: ".78rem" }}>Visitors (7d)</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{r.visits_week ?? 0}</div></div>
        <div style={{ alignSelf: "center", fontSize: "1.3rem", color: "var(--muted)" }}>→</div>
        <div className="card" style={{ padding: "12px 18px" }}><div className="muted" style={{ fontSize: ".78rem" }}>New leads (7d)</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{r.leads_week ?? 0}</div></div>
        <div style={{ alignSelf: "center", fontSize: "1.3rem", color: "var(--muted)" }}>→</div>
        <div className="card" style={{ padding: "12px 18px" }}><div className="muted" style={{ fontSize: ".78rem" }}>New signups (7d)</div><div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{r.signups_week ?? 0}</div></div>
      </div>
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
        The two numbers to watch weekly: <strong>new leads</strong> and <strong>new signups</strong>. If they grow, marketing works. If they&apos;re flat, tell me.
      </p>

      {/* Totals */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        <div className="card" style={{ padding: "10px 16px" }}><strong>{r.leads_total ?? 0}</strong> <span className="muted">total leads</span></div>
        <div className="card" style={{ padding: "10px 16px" }}><strong>{r.leads_verified ?? 0}</strong> <span className="muted">verified</span></div>
        <div className="card" style={{ padding: "10px 16px" }}><strong>{r.signups_month ?? 0}</strong> <span className="muted">signups (30d)</span></div>
        {yt && <div className="card" style={{ padding: "10px 16px" }}><strong>{yt.subscribers.toLocaleString("en-IN")}</strong> <span className="muted">YouTube subs</span></div>}
      </div>

      {/* Instagram at a glance */}
      <h2 className="admin-section-title" style={{ marginTop: 26 }}>📷 Instagram</h2>
      <div className="card" style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          {igOn ? (
            <span style={{ color: "#16a34a", fontWeight: 800 }}>🟢 Auto-posting connected</span>
          ) : (
            <span style={{ color: "#b45309", fontWeight: 800 }}>🟠 Not connected yet</span>
          )}
          <span className="muted">·</span>
          <span><strong>{igPosts30 ?? 0}</strong> <span className="muted">posts sent (30d)</span></span>
          <span className="muted">·</span>
          <span><strong>{igQueued ?? 0}</strong> <span className="muted">queued</span></span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn small" href="/admin/broadcasts">📣 Post a campaign</Link>
          <Link className="btn small secondary" href="/admin/integrations/meta">{igOn ? "⚙️ Connection" : "🔌 Connect Instagram"}</Link>
        </div>
      </div>
      {!igOn && (
        <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
          Paste your Meta access token on Integrations, then use <Link href="/admin/integrations/meta" style={{ color: "var(--accent)", fontWeight: 700 }}>Instagram / Facebook check</Link> to
          connect with one tap — campaigns will then post to Instagram automatically with an auto-designed 1080×1080 image.
        </p>
      )}

      {/* Which platform brings traffic */}
      <h2 className="admin-section-title" style={{ marginTop: 26 }}>🌐 Where visitors come from (30 days, tagged links)</h2>
      <div className="card" style={{ marginTop: 10 }}>
        <Bars rows={(r.traffic_by_src ?? []).map((x) => ({ k: x.src, c: x.c }))} label={(k) => SRC_LABEL[k] ?? k} />
        <p className="muted" style={{ fontSize: ".76rem", marginTop: 8 }}>
          Counts only links carrying <code>?src=</code>. Use these links everywhere so every platform is measured:
          YouTube → <code>?src=yt</code>, WhatsApp → <code>?src=wa</code>, Instagram → <code>?src=ig</code>,
          Meta ads → <code>?src=metaads</code>, Google ads → <code>?src=googleads</code>.
        </p>
      </div>

      {/* Leads by source + signups by heard-from */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 20 }} className="mkt-two">
        <div>
          <h3 style={{ margin: "0 0 8px" }}>📇 Leads by source</h3>
          <div className="card"><Bars rows={(r.leads_by_source ?? []).map((x) => ({ k: x.source, c: x.c }))} label={(k) => SRC_LABEL[k] ?? k} /></div>
        </div>
        <div>
          <h3 style={{ margin: "0 0 8px" }}>🎓 Signups: “how did you find us” (30d)</h3>
          <div className="card"><Bars rows={(r.signups_by_heard ?? []).map((x) => ({ k: x.heard, c: x.c }))} label={(k) => HEARD_LABEL[k] ?? k} /></div>
        </div>
      </div>

      {/* Quick links */}
      <h2 className="admin-section-title" style={{ marginTop: 26 }}>⚡ Jump to</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Link className="btn small secondary" href="/admin/broadcasts">📣 Campaigns ({r.campaigns_pending ?? 0} scheduled)</Link>
        <Link className="btn small secondary" href="/admin/leads">📇 Contacts & leads</Link>
        <Link className="btn small secondary" href="/admin/articles">📝 Articles</Link>
        <Link className="btn small secondary" href="/admin/youtube">▶️ YouTube</Link>
      </div>

      {/* The paid-ads playbook (Layer 3) */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }}>💰 Run paid ads — step by step</h2>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
        Your website side is ready: tracked landing pages, lead import, and the numbers above. You (or a staff member)
        run the ad accounts — I never touch your ad spend. Start small, watch cost-per-lead here, scale what works.
      </p>

      <details className="card" style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>📷 Instagram / Meta lead ads (best first step)</summary>
        <ol style={{ margin: "10px 0 0 18px", display: "grid", gap: 6, fontSize: ".9rem" }}>
          <li>Convert your Instagram to a <strong>Business account</strong> and link it to a Facebook Page (Instagram → Settings → Account type).</li>
          <li>Open <strong>Meta Ads Manager</strong> (business.facebook.com) → Create → objective <strong>Leads</strong> → use an <strong>Instant Form</strong> (the form opens inside Instagram and pre-fills name/email/phone).</li>
          <li>Use one of your <strong>short videos</strong> as the ad. Audience: India, age <strong>18–24</strong>, interests <strong>“Chartered Accountancy / CA exam / ICAI”</strong>.</li>
          <li>Make <strong>two ad sets</strong> — one “CA Foundation”, one “CA Intermediate” — so you can see which pays back.</li>
          <li>Budget: start <strong>₹300–500/day</strong> per ad set for a week.</li>
          <li>Each day/week: Ads Manager → Forms Library → <strong>Download leads (CSV)</strong> → import on <Link href="/admin/leads">Contacts &amp; leads</Link> (source “Instagram/WhatsApp”). They join your WhatsApp campaigns automatically.</li>
        </ol>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 8 }}>💡 Cost-per-lead below one subscription&apos;s worth = scale up. Above it = change the video or audience.</p>
      </details>

      <details className="card" style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>🔍 Google Ads (search + YouTube)</summary>
        <ol style={{ margin: "10px 0 0 18px", display: "grid", gap: 6, fontSize: ".9rem" }}>
          <li>Open <strong>Google Ads</strong> (ads.google.com) with your Google account.</li>
          <li><strong>Search campaign</strong>: keywords like “CA Foundation classes”, “CA Inter FR classes”, “CA Final FR online”. Landing page: <code>caparveensharma.com/free-planner?src=googleads</code>.</li>
          <li><strong>YouTube (video) campaign</strong>: run your short videos as ads before other CA content; same landing link.</li>
          <li>Budget: start <strong>₹300–500/day</strong>; add negative keywords (“free pdf”, “jobs”) to avoid waste.</li>
          <li>Traffic and signups from these show up above under <strong>💰 Google ads</strong> because of the <code>?src=googleads</code> tag.</li>
        </ol>
      </details>

      <details className="card" style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>📈 Reading the results (no marketing jargon)</summary>
        <ul style={{ margin: "10px 0 0 18px", display: "grid", gap: 6, fontSize: ".9rem" }}>
          <li><strong>In the ad platform</strong> you see spend &amp; cost-per-lead. <strong>Here</strong> you see leads &amp; signups from each source.</li>
          <li>Divide weekly ad spend by leads from that source (above) = your real cost per lead.</li>
          <li>If “💰 Meta ads” or “💰 Google ads” leads are growing and cost is sensible, spend more. If not, tell me and we fix the video, audience or landing page.</li>
        </ul>
      </details>

      <style>{`@media (max-width: 680px){ .mkt-two{ grid-template-columns:1fr !important; } }`}</style>
    </section>
  );
}
