import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Who is using the app — Admin" };

// WHO IS ON THE PHONE APP, BY NAME.
//
// Apple and Google report DOWNLOADS. We can only see people who opened the app
// AND signed in — so our number is always the smaller one, and the gap is not
// an error in either. Somebody who downloads it, opens it, looks at the login
// screen and closes it is a download to Apple and nothing at all to us: they
// never told us who they were.
//
// Which means this page can answer "who is using the app" and can never answer
// "who downloaded it". Nobody can answer the second one — the stores do not
// pass on names, and there is nothing in a download to identify.

const th: React.CSSProperties = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top", fontSize: ".86rem" };

export default async function AppUsersReport() {
  await assertArea("reports");
  const svc = createServiceClient();

  const [{ data: sessions }, { data: pushes }] = await Promise.all([
    svc.from("device_sessions").select("user_id, device_kind, updated_at").eq("device_kind", "app").limit(5000),
    svc.from("push_devices").select("user_id, platform, app_version, last_seen_at, created_at, disabled_at").limit(5000),
  ]);

  type S = { user_id: string; updated_at: string };
  type P = { user_id: string; platform: string | null; app_version: string | null; last_seen_at: string | null; created_at: string; disabled_at: string | null };
  const appSessions = (sessions ?? []) as S[];
  const push = (pushes ?? []) as P[];

  const ids = [...new Set([...appSessions.map((s) => s.user_id), ...push.map((p) => p.user_id)])];
  const { data: people } = ids.length
    ? await svc.from("profiles").select("id, full_name, email, phone, target_attempt").in("id", ids)
    : { data: [] };

  type Person = { id: string; full_name: string | null; email: string | null; phone: string | null; target_attempt: string | null };
  const byId = new Map((people ?? []).map((p) => [String((p as Person).id), p as Person]));

  const lastApp = new Map<string, string>();
  for (const s of appSessions) lastApp.set(s.user_id, s.updated_at);

  const pushBy = new Map<string, P[]>();
  for (const p of push) pushBy.set(p.user_id, [...(pushBy.get(p.user_id) ?? []), p]);

  const rows = ids.map((id) => {
    const ps = pushBy.get(id) ?? [];
    const platforms = [...new Set(ps.map((p) => p.platform).filter(Boolean))] as string[];
    const seen = [lastApp.get(id), ...ps.map((p) => p.last_seen_at)].filter(Boolean).sort().pop() ?? null;
    return {
      id, person: byId.get(id) ?? null,
      platforms,
      version: ps.map((p) => p.app_version).filter(Boolean)[0] ?? null,
      notifications: ps.some((p) => !p.disabled_at),
      signedInFromApp: lastApp.has(id),
      seen,
    };
  }).sort((a, b) => (b.seen ?? "").localeCompare(a.seen ?? ""));

  const ios = rows.filter((r) => r.platforms.includes("ios")).length;
  const android = rows.filter((r) => r.platforms.includes("android")).length;
  const noPush = rows.filter((r) => r.platforms.length === 0).length;

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 1050 }}>
      <AdminHero
        badge="📱 The app"
        title="Who is actually using the app"
        subtitle="Everyone who has opened the phone app and signed in — by name, with how to reach them."
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <div className="admin-cards" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="admin-tile"><div className="tile-ic">📱</div><h3 style={{ fontSize: "1.5rem" }}>{rows.length}</h3><p>people, signed in from the app</p></div>
        <div className="admin-tile"><div className="tile-ic">🍎</div><h3 style={{ fontSize: "1.5rem" }}>{ios}</h3><p>on iPhone</p></div>
        <div className="admin-tile"><div className="tile-ic">🤖</div><h3 style={{ fontSize: "1.5rem" }}>{android}</h3><p>on Android</p></div>
        <div className="admin-tile"><div className="tile-ic">🔕</div><h3 style={{ fontSize: "1.5rem" }}>{noPush}</h3><p>notifications off</p></div>
      </div>

      {/* THE GAP, EXPLAINED BEFORE IT IS ASKED ABOUT. */}
      <div className="notice" style={{ marginTop: 16, lineHeight: 1.7, fontSize: ".88rem" }}>
        <strong>This will always be smaller than Apple&apos;s or Google&apos;s download count, and neither is wrong.</strong>{" "}
        The stores count every install and re-install, across every Apple ID and every device, including people who
        downloaded it and never opened it, or opened it and never signed in. We can only see somebody once they sign
        in — before that they have not told us who they are. A re-install counts again for the store and not at all
        here.
        <br /><br />
        <strong>Nobody can give you the names behind a download.</strong> Apple and Google do not pass them on, and
        there is nothing in a download to identify — which is why this page is titled who is <em>using</em> the app.
        The people below are real, named and reachable; the difference between this number and the store&apos;s is
        made of people who have not yet come far enough to be known.
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>Every one of them</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Student</th><th style={th}>Phone</th><th style={th}>Email</th>
            <th style={th}>Phone type</th><th style={th}>Notifications</th><th style={th}>Attempt</th><th style={th}>Last seen</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td style={td} colSpan={7}><span className="muted">Nobody has signed in from the app yet.</span></td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>
                  <Link href={`/admin/users/${r.id}`}>{r.person?.full_name || "—"}</Link>
                </td>
                <td style={td}>{r.person?.phone || <span className="muted">none</span>}</td>
                <td style={td}>{r.person?.email || "—"}</td>
                <td style={td}>
                  {r.platforms.length
                    ? r.platforms.map((p) => (p === "ios" ? "🍎 iPhone" : "🤖 Android")).join(" + ")
                    : <span className="muted">signed in, no push</span>}
                  {r.version ? <><br /><span className="muted" style={{ fontSize: ".76rem" }}>v{r.version}</span></> : null}
                </td>
                <td style={td}>{r.notifications ? "on" : <span className="muted">off</span>}</td>
                <td style={td}>{r.person?.target_attempt || "—"}</td>
                <td style={td}>{r.seen ? formatDate(r.seen) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
