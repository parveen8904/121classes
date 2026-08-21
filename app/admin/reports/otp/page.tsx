import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";

export const dynamic = "force-dynamic";
export const metadata = { title: "Phone verifications — Admin" };

// Who verified their phone, and did the code actually reach them?
//
// The founder's question on 19 August — "how many OTP were verified today
// through WhatsApp?" — had no page to answer it. Now it does. Two things are
// worth reading here: the verified-to-sent ratio (a code that is sent but never
// entered usually means it never arrived), and the gap between sent and
// verified times (seconds when the channel is healthy).

const IST = "Asia/Kolkata";
const timeIst = (v: string | null) =>
  v ? new Date(v).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST }) : "—";
const dayIst = (v: string) =>
  new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });

export default async function OtpReportPage() {
  await assertArea("reports");
  const svc = createServiceClient();
  const since14 = new Date(Date.now() - 14 * 86400_000).toISOString();

  const { data: otps } = await svc
    .from("phone_otps")
    .select("user_id, phone_e164, channel, sent_at, expires_at, consumed_at")
    .gte("sent_at", since14)
    .order("sent_at", { ascending: false })
    .limit(200);

  const rows = otps ?? [];
  const people = new Map<string, { name: string; email: string }>();
  const ids = [...new Set(rows.map((r) => String(r.user_id)).filter(Boolean))];
  if (ids.length) {
    const { data: profs } = await svc.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of profs ?? []) people.set(String(p.id), { name: String(p.full_name ?? ""), email: String(p.email ?? "") });
  }

  // Per-day counts, IST days — the founder reads this at night, and "today"
  // must mean his today, not the server's.
  const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: IST });
  const byDay = new Map<string, { sent: number; verified: number }>();
  for (const r of rows) {
    const d = new Date(String(r.sent_at)).toLocaleDateString("en-CA", { timeZone: IST });
    if (!byDay.has(d)) byDay.set(d, { sent: 0, verified: 0 });
    const c = byDay.get(d)!;
    c.sent += 1;
    if (r.consumed_at) c.verified += 1;
  }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const today = byDay.get(todayIst) ?? { sent: 0, verified: 0 };

  const status = (r: { consumed_at: string | null; expires_at: string | null }) => {
    if (r.consumed_at) return { label: `✅ verified ${timeIst(r.consumed_at)}`, ok: true };
    if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return { label: "⌛ never entered", ok: false };
    return { label: "⏳ waiting", ok: true };
  };

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📲 Phone verifications"
        title="Who verified their phone, and did the code arrive?"
        subtitle="Every OTP of the last 14 days. A code sent but never entered usually means it never arrived — that is the row worth ringing about."
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <div className="admin-cards" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: 16 }}>
        <div className="admin-tile">
          <div className="tile-ic">📤</div>
          <h3 style={{ fontSize: "1.5rem" }}>{today.sent}</h3>
          <p>Sent today</p>
        </div>
        <div className="admin-tile">
          <div className="tile-ic">✅</div>
          <h3 style={{ fontSize: "1.5rem" }}>{today.verified}</h3>
          <p>Verified today</p>
        </div>
        <div className="admin-tile">
          <div className="tile-ic">📈</div>
          <h3 style={{ fontSize: "1.5rem" }}>
            {rows.length ? Math.round((rows.filter((r) => r.consumed_at).length / rows.length) * 100) : 0}%
          </h3>
          <p>Verified, last 14 days</p>
        </div>
      </div>

      <h2 className="admin-section-title">📅 Day by day</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {days.map(([d, c]) => (
          <div className="list-row" key={d}>
            <span className="row-title">{dayIst(d)}{d === todayIst ? " — today" : ""}</span>
            <span>
              <strong>{c.verified}</strong> verified of {c.sent} sent
              {c.sent > c.verified && (
                <span style={{ color: "#b45309", fontWeight: 700, marginLeft: 10 }}>{c.sent - c.verified} never entered</span>
              )}
            </span>
          </div>
        ))}
        {days.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No codes sent in 14 days.</p></div>}
      </div>

      <h2 className="admin-section-title">📋 Every code, newest first</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".85rem" }}>
          <thead>
            <tr>
              {["Student", "Phone", "Channel", "Sent", "Outcome"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const who = people.get(String(r.user_id));
              const st = status(r as { consumed_at: string | null; expires_at: string | null });
              return (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px" }}>
                    {r.user_id ? <a href={`/admin/users/${r.user_id}`}>{who?.name || who?.email || "—"}</a> : "—"}
                    {who?.name && who?.email ? <div className="muted" style={{ fontSize: ".76rem" }}>{who.email}</div> : null}
                  </td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{String(r.phone_e164 ?? "")}</td>
                  <td style={{ padding: "6px 8px" }}>{String(r.channel) === "whatsapp" ? "💬 WhatsApp" : String(r.channel ?? "")}</td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{dayIst(String(r.sent_at))} · {timeIst(String(r.sent_at))}</td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: st.ok ? undefined : "#b45309", fontWeight: st.ok ? undefined : 700 }}>{st.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
