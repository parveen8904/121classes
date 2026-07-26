import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { markTeamDone } from "./actions";
import { AUTO_FIELDS, FIELD_LABEL } from "@/lib/campaignChannels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing & campaigns — Admin" };

// One home for marketing. The founder had three tiles that overlapped —
// overview, campaigns and articles — and could not tell which did what. This
// is the front door: what needs doing, what is going out, and everything else
// one click away.

type Post = {
  id: string; body: string; campaign: string | null; campaign_id: string | null; status: string;
  send_at: string; source_kind: string | null; source_label: string | null;
  team_done_at: string | null; created_by: string | null;
} & Record<string, unknown>;

const istFmt = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const fieldOf = (p: Post) => Object.keys(FIELD_LABEL).find((f) => p[f] === true) ?? "";
const KIND: Record<string, string> = { news: "📰 news", article: "📝 article", greeting: "🎉 greeting", event: "📅 event", idea: "💡 idea" };

export default async function MarketingHome() {
  const svc = createServiceClient();
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();

  const [{ data: postRows }, { count: articleCount }, { count: pendingNews }, { data: settingRows }] = await Promise.all([
    svc.from("scheduled_posts").select("*").gte("send_at", since).order("send_at", { ascending: false }).limit(200),
    svc.from("articles").select("id", { count: "exact", head: true }).eq("is_published", true),
    svc.from("announcements").select("id", { count: "exact", head: true }).eq("from_feed", true),
    svc.from("site_settings").select("key, value").in("key", ["marketing_autopilot"]),
  ]);
  const posts = (postRows ?? []) as Post[];
  const autopilotOn = (settingRows ?? []).some((r) => r.key === "marketing_autopilot" && r.value === "on");

  // Things a person still has to post by hand, that are already due.
  const teamJobs = posts.filter(
    (p) => !AUTO_FIELDS.has(fieldOf(p)) && !p.team_done_at && p.status !== "draft" && new Date(p.send_at) <= new Date(),
  );
  const drafts = posts.filter((p) => p.status === "draft");
  const upcoming = posts.filter((p) => p.status === "pending" && new Date(p.send_at) > new Date());

  // Drafts grouped into the campaigns they belong to.
  const draftCampaigns = [...new Map(drafts.map((p) => [p.campaign_id, p])).values()];

  const tile = { display: "block", padding: 14, border: "1px solid var(--border)", borderRadius: 10, textDecoration: "none" } as const;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 960 }}>
      <AdminHero
        badge="📣 Marketing"
        title="Marketing & campaigns"
        subtitle="Everything that goes out to the world — campaigns, the weekly rhythm, articles, greetings and what your team still has to post by hand. 🌍"
        back={{ href: "/admin", label: "Admin" }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <a className="btn" href="/admin/campaigns/new">✨ Start a campaign</a>
        <a className="btn secondary" href="/admin/broadcasts">Posts, autopilot &amp; the weekly rhythm</a>
        <a className="btn secondary" href="/admin/articles">Articles &amp; SEO</a>
        <a className="btn secondary" href="/admin/marketing">Where students come from</a>
      </div>

      {/* Waiting on a person */}
      {teamJobs.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 8px" }}>📋 Waiting for your team — {teamJobs.length} to post by hand</h3>
          <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
            No outside tool can post to these. The text was emailed at the scheduled time; tick each off once it is up.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {teamJobs.map((p) => (
              <div className="list-row" key={p.id}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="row-title">⬜ {FIELD_LABEL[fieldOf(p)]}{p.campaign ? ` — ${p.campaign}` : ""}</span>
                  <p className="row-sub" style={{ whiteSpace: "pre-wrap" }}>{p.body.slice(0, 160)}{p.body.length > 160 ? "…" : ""}</p>
                </div>
                <div className="row-actions">
                  {p.campaign_id && <a className="btn small secondary" href={`/admin/campaigns/${p.campaign_id}`}>Open</a>}
                  <form action={markTeamDone}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="btn small" savedLabel="✓ Done">Mark done</SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Half-finished campaigns */}
      {draftCampaigns.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 8px" }}>✍️ Not finished — {draftCampaigns.length} campaign(s) written but not scheduled</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {draftCampaigns.map((p) => (
              <a className="list-row" key={p.campaign_id} href={`/admin/campaigns/${p.campaign_id}`} style={{ textDecoration: "none" }}>
                <div style={{ minWidth: 0 }}>
                  <span className="row-title">{p.campaign || "Untitled campaign"}</span>
                  <p className="row-sub">
                    {p.source_kind ? `${KIND[p.source_kind] ?? p.source_kind} · ` : ""}
                    {drafts.filter((d) => d.campaign_id === p.campaign_id).length} posts waiting to be read
                  </p>
                </div>
                <div className="row-actions"><span className="btn small">Read them →</span></div>
              </a>
            ))}
          </div>
        </>
      )}

      {/* What is coming */}
      <h3 style={{ margin: "24px 0 8px" }}>⏳ Going out next ({upcoming.length})</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {upcoming.length === 0 && (
          <div className="card"><p className="muted" style={{ margin: 0 }}>
            Nothing scheduled. {autopilotOn ? "The weekly autopilot writes the next week on Monday morning." : "The weekly autopilot is switched off."}
          </p></div>
        )}
        {upcoming.slice(0, 12).map((p) => (
          <div className="list-row" key={p.id}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title" style={{ fontWeight: 500 }}>{p.body.slice(0, 110)}{p.body.length > 110 ? "…" : ""}</span>
              <p className="row-sub">
                {FIELD_LABEL[fieldOf(p)]} · 🕐 {istFmt(p.send_at)} IST
                {p.source_kind ? ` · ${KIND[p.source_kind] ?? p.source_kind}` : p.created_by === "autopilot" ? " · 🤖 autopilot" : ""}
              </p>
            </div>
            <div className="row-actions">
              {p.campaign_id
                ? <a className="btn small secondary" href={`/admin/campaigns/${p.campaign_id}`}>Open</a>
                : <a className="btn small secondary" href="/admin/broadcasts">Edit</a>}
            </div>
          </div>
        ))}
      </div>

      {/* The rest, one click away */}
      <h3 style={{ margin: "24px 0 8px" }}>Everything else</h3>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <a href="/admin/broadcasts" style={tile}>
          <strong>🤖 Weekly autopilot &amp; rhythm</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
            {autopilotOn ? "On" : "Off"} — the teaching posts that go out on their own, and how often each platform speaks.
          </p>
        </a>
        <a href="/admin/broadcasts/festivals" style={tile}>
          <strong>🎉 Festival greetings</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>Which days we wish students on, and how big each one is.</p>
        </a>
        <a href="/admin/articles" style={tile}>
          <strong>📝 Articles &amp; SEO</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
            {articleCount ?? 0} published. Any of them can become a campaign — pick &ldquo;an article we published&rdquo;.
          </p>
        </a>
        <a href="/admin/announcements" style={tile}>
          <strong>📰 News feed</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
            {pendingNews ?? 0} items collected. Nothing is written about unless you choose it.
          </p>
        </a>
        <a href="/admin/marketing" style={tile}>
          <strong>📊 Where students come from</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>Leads, signups and which platform actually brings students.</p>
        </a>
        <a href="/admin/leads" style={tile}>
          <strong>📇 Contacts &amp; leads</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>Imported contacts and the WhatsApp audience.</p>
        </a>
      </div>
    </section>
  );
}
