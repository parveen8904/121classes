import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { getChannelOverview, getRecentVideos } from "@/lib/youtubeStats";

export const dynamic = "force-dynamic";
export const metadata = { title: "YouTube — Admin" };

const n = (x: number) => x.toLocaleString("en-IN");

export default async function YouTubeAdminPage() {
  const overview = await getChannelOverview();
  const videos = overview?.uploadsPlaylist ? await getRecentVideos(overview.uploadsPlaylist) : [];

  // Site-side attribution: what YouTube actually sends us.
  const svc = createServiceClient();
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
  const [{ count: ytVisits7d }, { count: ytSignups }, { count: ytLeads }] = await Promise.all([
    svc.from("page_views").select("id", { count: "exact", head: true }).like("path", "%src=yt%").gte("created_at", weekAgo),
    svc.from("profiles").select("id", { count: "exact", head: true }).eq("heard_from", "youtube"),
    svc.from("leads").select("id", { count: "exact", head: true }).or("source.eq.youtube,note.ilike.%youtube%,note.ilike.%via yt%"),
  ]);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="▶️ YouTube"
        title="YouTube performance"
        subtitle="Your channel's numbers next to what YouTube actually sends the website — views are vanity, signups are sanity. 📊"
        back={{ href: "/admin", label: "Admin" }}
      />

      {!overview ? (
        <div className="notice err" style={{ marginTop: 16 }}>
          To connect the channel, add two things on <strong>Integrations</strong>: the <strong>YouTube Data API key</strong> (already
          used for video durations{" "}— you may have it) and the new <strong>YouTube channel</strong> field (your channel link or @handle). Then reload this page.
        </div>
      ) : (
        <>
          {/* Channel overview */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <div className="card" style={{ padding: "10px 16px" }}><strong>{n(overview.subscribers)}</strong> <span className="muted">subscribers</span></div>
            <div className="card" style={{ padding: "10px 16px" }}><strong>{n(overview.totalViews)}</strong> <span className="muted">lifetime views</span></div>
            <div className="card" style={{ padding: "10px 16px" }}><strong>{n(overview.videoCount)}</strong> <span className="muted">videos</span></div>
          </div>

          {/* What YouTube sends the SITE */}
          <h2 className="admin-section-title" style={{ marginTop: 24 }}>🎯 What YouTube sends the website</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <div className="card" style={{ padding: "10px 16px" }}><strong>{ytVisits7d ?? 0}</strong> <span className="muted">visits via ?src=yt (7 days)</span></div>
            <div className="card" style={{ padding: "10px 16px" }}><strong>{ytSignups ?? 0}</strong> <span className="muted">students who said &ldquo;found via YouTube&rdquo;</span></div>
            <div className="card" style={{ padding: "10px 16px" }}><strong>{ytLeads ?? 0}</strong> <span className="muted">leads from YouTube</span></div>
          </div>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
            Visits count only links carrying <code>?src=yt</code> — use that link in every description, pinned comment and
            community post. If visits are low while views are high, the link isn&apos;t visible enough in the videos.
          </p>

          {/* Recent videos */}
          <h2 className="admin-section-title" style={{ marginTop: 24 }}>🎬 Latest videos</h2>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "6px 8px" }}>Video</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Published</th>
                  <th style={{ padding: "6px 8px" }}>Views</th>
                  <th style={{ padding: "6px 8px" }}>Likes</th>
                  <th style={{ padding: "6px 8px" }}>Comments</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                      <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer">{v.title}</a>
                    </td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{v.publishedAt ? new Date(v.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{n(v.views)}</td>
                    <td style={{ padding: "6px 8px" }}>{n(v.likes)}</td>
                    <td style={{ padding: "6px 8px" }}>{n(v.comments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 8 }}>
            This shows everything YouTube makes public (views, likes, comments, subscribers). Watch-time, retention and
            audience demographics exist only inside <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer">YouTube Studio</a> — YouTube doesn&apos;t share those through any API key. The real gold here is the
            middle section: it connects your channel to actual signups.
          </p>
        </>
      )}
    </section>
  );
}
