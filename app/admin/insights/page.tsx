import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Student insights — Admin" };

type Insights = {
  topic_views: { topic: string; subject: string | null; views: number; students: number }[];
  doubt_areas: { area: string; doubts: number }[];
  heard_from: { source: string; students: number }[];
  dropoffs: { name: string | null; email: string; phone: string | null; level?: string | null; joined: string; last_login: string | null; bucket: string }[];
};

const HEARD_LABEL: Record<string, string> = {
  youtube: "▶️ YouTube", telegram: "✈️ Telegram", friend: "🤝 Friend / classmate", google: "🔍 Google",
  instagram: "📸 Instagram", whatsapp: "💬 WhatsApp", attended_before: "🎓 Attended classes before", other: "Other",
  "(not answered)": "(not answered)",
};

export default async function InsightsPage() {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("admin_insights_report");
  const r = data as Insights | null;

  const th = { padding: "6px 8px", textAlign: "left" as const, color: "var(--muted)" };
  const td = { padding: "6px 8px" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1000 }}>
      <AdminHero
        badge="🔍 Student insights"
        title="What students want — and who needs a call"
        subtitle="Topic interest, where doubts come from, how students found us, and the drop-off call-list. 📞"
        back={{ href: "/admin", label: "Admin" }}
      />

      {(!r || error) ? (
        <div className="card" style={{ marginTop: 16 }}><p className="muted">Couldn&apos;t load insights{error ? `: ${error.message}` : ""}. Refresh in a moment.</p></div>
      ) : (
        <>
          {/* Drop-off call-list — the actionable one first. */}
          <h3 style={{ margin: "22px 0 8px" }}>📞 Call-list — students slipping away ({r.dropoffs.length})</h3>
          <div className="card">
            <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
              <strong>Never started</strong> = registered but never logged in (2+ days ago) — they probably got stuck; a call
              wins them back. <strong>Inactive</strong> = no login for 14+ days.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                <thead><tr><th style={th}>Name</th><th style={th}>Level</th><th style={th}>Email</th><th style={th}>WhatsApp</th><th style={th}>Joined</th><th style={th}>Last login</th><th style={th}>Status</th></tr></thead>
                <tbody>
                  {r.dropoffs.map((d, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontWeight: 600 }}>{d.name || "—"}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{d.level || "—"}</td>
                      <td style={td}>{d.email}</td>
                      <td style={td}>{d.phone || "—"}</td>
                      <td style={td}>{d.joined}</td>
                      <td style={td}>{d.last_login || "never"}</td>
                      <td style={{ ...td, fontWeight: 700, color: d.bucket === "never_started" ? "#b91c1c" : "#b45309" }}>
                        {d.bucket === "never_started" ? "🔴 never started" : "🟠 inactive 14d+"}
                      </td>
                    </tr>
                  ))}
                  {r.dropoffs.length === 0 && <tr><td style={td} colSpan={7} className="muted">Nobody slipping — great! 🎉</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Topic interest */}
          <h3 style={{ margin: "26px 0 8px" }}>📈 Most-viewed topics (last 30 days)</h3>
          <div className="card">
            {r.topic_views.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>
                Page-view tracking just went live — this fills up over the coming days as students browse.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                  <thead><tr><th style={th}>Topic</th><th style={th}>Subject</th><th style={th}>Views</th><th style={th}>Students</th></tr></thead>
                  <tbody>
                    {r.topic_views.map((t, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...td, fontWeight: 600 }}>{t.topic}</td>
                        <td style={td}>{t.subject ?? "—"}</td>
                        <td style={td}>{t.views}</td>
                        <td style={td}>{t.students}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Doubt areas */}
          <h3 style={{ margin: "26px 0 8px" }}>💬 Where doubts come from (last 30 days)</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {r.doubt_areas.map((d) => (
              <span key={d.area} className="card" style={{ padding: "6px 12px", fontSize: ".84rem" }}>
                <strong>{d.area}</strong> · {d.doubts} doubt{d.doubts === 1 ? "" : "s"}
              </span>
            ))}
            {r.doubt_areas.length === 0 && <span className="muted">No doubts recorded yet.</span>}
          </div>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
            Topics with many doubts are where students struggle — good candidates for a revision video or case studies.
          </p>

          {/* Marketing attribution */}
          <h3 style={{ margin: "26px 0 8px" }}>📣 How students found us</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {r.heard_from.map((h) => (
              <span key={h.source} className="card" style={{ padding: "6px 12px", fontSize: ".84rem" }}>
                <strong>{HEARD_LABEL[h.source] ?? h.source}</strong> · {h.students}
              </span>
            ))}
          </div>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
            Asked once in the new-student setup wizard (started today) — existing students were never asked, so
            &ldquo;(not answered)&rdquo; shrinks as new students join.
          </p>
        </>
      )}
    </section>
  );
}
