import AdminHero from "../../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Direct-message audience — Admin" };

// Who "Direct to students" actually reaches. Reached by clicking that channel
// in the list on the marketing home, rather than sitting as a section of its
// own on another page.

type Audience = {
  name: string | null; email: string | null; telegram_id: string;
  level: string; enrolled: string; ai_questions: number; group_messages: number; source: string;
};

export default async function AudiencePage() {
  const { data } = await createServiceClient().rpc("admin_dm_audience");
  const audience = (data ?? []) as Audience[];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📩 Direct messages"
        title={`${audience.length} ${audience.length === 1 ? "person" : "people"} reachable`}
        subtitle="Everyone who has pressed Start on the bot — Telegram only allows a personal message to these. It grows every time a student taps the bot. 💬"
        back={{ href: "/admin/campaigns", label: "Marketing" }}
      />

      {audience.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted" style={{ margin: 0 }}>
            Nobody yet — once students press Start on @Caclassesbot they appear here with full details.
          </p>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px" }}>Level</th>
                <th style={{ padding: "6px 8px" }}>Email</th>
                <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Telegram ID</th>
                <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Enrolled</th>
                <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>AI questions</th>
                <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Group messages</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {audience.map((a, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{a.name || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{a.level}</td>
                  <td style={{ padding: "6px 8px" }}>{a.email || "—"}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: ".76rem" }}>{a.telegram_id}</td>
                  <td style={{ padding: "6px 8px" }}>{a.enrolled}</td>
                  <td style={{ padding: "6px 8px", fontWeight: 700 }}>{a.ai_questions}</td>
                  <td style={{ padding: "6px 8px" }}>{a.group_messages}</td>
                  <td style={{ padding: "6px 8px" }}>{a.source === "portal student" ? "🎓 portal student" : "💬 bot subscriber"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
