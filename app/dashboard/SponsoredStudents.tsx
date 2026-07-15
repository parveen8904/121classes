import { createServiceClient } from "@/lib/supabase/service";

// A sponsor's view: the students they've gifted a subscription to, and each
// one's basic activity. Deliberately shows NO amounts here (the sponsor already
// got the invoice by email; the dashboard stays about the students).
export default async function SponsoredStudents({ gifterId }: { gifterId: string }) {
  const svc = createServiceClient();
  const { data: gifts } = await svc
    .from("gift_orders")
    .select("id, recipient_name, recipient_email, recipient_user_id, tier, months, status, created_at, subject_id")
    .eq("gifter_id", gifterId)
    .order("created_at", { ascending: false });
  const rows = (gifts ?? []).filter((g) => g.status === "provisioned" || g.status === "paid");

  // Light activity: last-seen + subjects viewed, per sponsored student.
  const ids = rows.map((r) => r.recipient_user_id).filter(Boolean) as string[];
  const lastSeen = new Map<string, string>();
  if (ids.length) {
    const { data: pv } = await svc.from("page_views").select("user_id, created_at").in("user_id", ids).order("created_at", { ascending: false }).limit(500);
    for (const v of pv ?? []) if (!lastSeen.has(v.user_id as string)) lastSeen.set(v.user_id as string, v.created_at as string);
  }
  const subjTitles = new Map<string, string>();
  const sids = [...new Set(rows.map((r) => r.subject_id).filter(Boolean))] as string[];
  if (sids.length) {
    const { data: subs } = await svc.from("subjects").select("id, title").in("id", sids);
    for (const s of subs ?? []) subjTitles.set(s.id as string, s.title as string);
  }
  const when = (s?: string) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "not yet");

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: "1.2rem" }}>🎁 Students you&apos;ve sponsored</h2>
      {rows.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>You haven&apos;t sponsored anyone yet. <a className="grad" href="/gift">Sponsor a student →</a></p></div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((g) => (
            <div key={g.id} className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>{g.recipient_name}</strong> <span className="muted" style={{ fontSize: ".82rem" }}>· {g.recipient_email}</span>
                <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
                  🎓 {subjTitles.get(g.subject_id as string) ?? "Subject"} · {g.tier} ({g.months}m) · gifted {when(g.created_at)}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: ".82rem" }} className="muted">
                Last active: <strong>{g.recipient_user_id ? when(lastSeen.get(g.recipient_user_id)) : "—"}</strong>
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: ".76rem", margin: "2px 0 0" }}>Your payment receipts &amp; GST invoices were emailed to you. Students never see the amount you paid.</p>
        </div>
      )}
    </div>
  );
}
