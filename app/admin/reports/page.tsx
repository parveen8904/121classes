import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";
import { formatINR } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";

const inr = (n: number) => "₹" + (Math.round(n) || 0).toLocaleString("en-IN");

function fmt(s: string): string {
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type SubRow = { status: string; ends_at: string | null; plans: { tier: string } | null };
type BookOrderRow = {
  amount_inr: number;
  status: string;
  created_at: string;
  items: { book_id?: string; qty?: number }[] | null;
};

export default async function ReportsPage() {
  const supabase = createClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [{ data: subOrders }, { data: bookOrders }, { data: subs }, { count: students }, { data: books }] =
    await Promise.all([
      supabase.from("orders").select("amount_inr, created_at").eq("kind", "subscription").eq("status", "paid"),
      supabase.from("book_orders").select("amount_inr, status, created_at, items"),
      supabase.from("subscriptions").select("status, ends_at, plans(tier)"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
      supabase.from("books").select("id, title"),
    ]);

  const subRevenue = (subOrders ?? []).reduce((s, o) => s + (o.amount_inr ?? 0), 0);
  const subRevenueMonth = (subOrders ?? [])
    .filter((o) => o.created_at >= monthStart)
    .reduce((s, o) => s + (o.amount_inr ?? 0), 0);

  const paidBookOrders = ((bookOrders ?? []) as BookOrderRow[]).filter((o) => o.status !== "cancelled");
  const bookRevenue = paidBookOrders.reduce((s, o) => s + (o.amount_inr ?? 0), 0);
  const bookRevenueMonth = paidBookOrders
    .filter((o) => o.created_at >= monthStart)
    .reduce((s, o) => s + (o.amount_inr ?? 0), 0);

  const totalRevenue = subRevenue + bookRevenue;
  const monthRevenue = subRevenueMonth + bookRevenueMonth;

  const subsRows = (subs ?? []) as unknown as SubRow[];
  const activeSubs = subsRows.filter(
    (s) => s.status === "active" && (!s.ends_at || new Date(s.ends_at) > now),
  );
  const byTier: Record<string, number> = { bronze: 0, silver: 0, gold: 0 };
  for (const s of activeSubs) {
    const t = s.plans?.tier;
    if (t && t in byTier) byTier[t] += 1;
  }

  // Top books by quantity sold.
  const titleById = new Map((books ?? []).map((b) => [b.id, b.title]));
  const qtyByBook = new Map<string, number>();
  for (const o of paidBookOrders) {
    for (const it of o.items ?? []) {
      if (it.book_id) qtyByBook.set(it.book_id, (qtyByBook.get(it.book_id) ?? 0) + (it.qty ?? 0));
    }
  }
  const topBooks = [...qtyByBook.entries()]
    .map(([id, qty]) => ({ title: titleById.get(id) ?? "Book", qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const toDispatch = paidBookOrders.filter((o) => o.status === "paid").length;

  const kpis = [
    { icon: "💰", label: "Total revenue", value: formatINR(totalRevenue) },
    { icon: "📅", label: "This month", value: formatINR(monthRevenue) },
    { icon: "🎓", label: "Active subscriptions", value: String(activeSubs.length) },
    { icon: "👥", label: "Students", value: String(students ?? 0) },
    { icon: "📦", label: "Book orders", value: String(paidBookOrders.length) },
    { icon: "🚚", label: "Awaiting dispatch", value: String(toDispatch) },
  ];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📊 Reports"
        title="Reports & finance"
        subtitle="A live snapshot of revenue, enrolments and book sales. 📈"
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="admin-cards" style={{ marginTop: 24, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        {kpis.map((k) => (
          <div className="admin-tile" key={k.label}>
            <div className="tile-ic">{k.icon}</div>
            <h3 style={{ fontSize: "1.5rem" }}>{k.value}</h3>
            <p>{k.label}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>💵 Revenue split</h3>
          <p style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="muted">📘 Subscriptions</span> <strong>{formatINR(subRevenue)}</strong>
          </p>
          <p style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span className="muted">📦 Books</span> <strong>{formatINR(bookRevenue)}</strong>
          </p>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>🎓 Active plans by tier</h3>
          <p style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="muted">🥉 Bronze</span> <strong>{byTier.bronze}</strong>
          </p>
          <p style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span className="muted">🥈 Silver</span> <strong>{byTier.silver}</strong>
          </p>
          <p style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span className="muted">🥇 Gold</span> <strong>{byTier.gold}</strong>
          </p>
        </div>
      </div>

      <h2 className="admin-section-title">🏆 Top-selling books</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {topBooks.length > 0 ? (
          topBooks.map((b) => (
            <div className="list-row" key={b.title}>
              <span className="row-title">📚 {b.title}</span>
              <strong>{b.qty} sold</strong>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No book sales yet.</p>
          </div>
        )}
      </div>

      {/* Gift subscriptions — transactions, GST breakup & invoices */}
      {await (async () => {
        const svc = createServiceClient();
        const { data: gifts } = await svc
          .from("gift_orders")
          .select("id, created_at, paid_at, status, recipient_name, recipient_email, billing_name, billing_state, amount_inr, taxable_value, cgst, sgst, igst, invoice_no, invoice_url, tier, months")
          .order("created_at", { ascending: false })
          .limit(200);
        const paid = (gifts ?? []).filter((g) => g.status === "provisioned" || g.status === "paid");
        const total = paid.reduce((s, g) => s + Number(g.amount_inr || 0), 0);
        const tax = paid.reduce((s, g) => s + Number(g.cgst || 0) + Number(g.sgst || 0) + Number(g.igst || 0), 0);
        const th = { padding: "6px 8px", textAlign: "left" as const, color: "var(--muted)" };
        const td = { padding: "6px 8px" };
        return (
          <div style={{ marginTop: 28 }}>
            <h2 className="admin-section-title">🎁 Gift subscriptions &amp; invoices</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0 12px" }}>
              <span className="card" style={{ padding: "6px 12px" }}><strong>{paid.length}</strong> gifts · {inr(total)} collected · GST {inr(tax)}</span>
            </div>
            {paid.length === 0 ? (
              <div className="card"><p className="muted" style={{ margin: 0 }}>No gift purchases yet.</p></div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
                  <thead><tr>
                    <th style={th}>Date</th><th style={th}>Invoice</th><th style={th}>Gifter</th><th style={th}>Recipient</th>
                    <th style={th}>Plan</th><th style={th}>State</th><th style={th}>Taxable</th><th style={th}>CGST</th><th style={th}>SGST</th><th style={th}>IGST</th><th style={th}>Total</th><th style={th}>Invoice</th>
                  </tr></thead>
                  <tbody>
                    {paid.map((g) => (
                      <tr key={g.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={td}>{fmt(g.paid_at || g.created_at)}</td>
                        <td style={td}>{g.invoice_no || "—"}</td>
                        <td style={td}>{g.billing_name || "—"}</td>
                        <td style={td}>{g.recipient_name}<br /><span className="muted">{g.recipient_email}</span></td>
                        <td style={td}>{g.tier} · {g.months}m</td>
                        <td style={td}>{g.billing_state}</td>
                        <td style={td}>{inr(Number(g.taxable_value || 0))}</td>
                        <td style={td}>{inr(Number(g.cgst || 0))}</td>
                        <td style={td}>{inr(Number(g.sgst || 0))}</td>
                        <td style={td}>{inr(Number(g.igst || 0))}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{inr(Number(g.amount_inr || 0))}</td>
                        <td style={td}>{g.invoice_url ? <a className="grad" href={viaProxy(g.invoice_url)} target="_blank" rel="noopener noreferrer">PDF ↓</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      <p className="muted" style={{ fontSize: ".82rem", marginTop: 24 }}>
        As of {fmt(now.toISOString())} · revenue counts paid online orders (Razorpay). Admin-granted
        free enrolments don&apos;t add revenue.
      </p>
    </section>
  );
}
