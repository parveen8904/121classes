import { formatDate } from "@/lib/dates";
import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supporters report — Admin" };

// Two reports on one page, because his office reads them together: WHO the
// supporters are, and WHAT each of them has bought. The shapes follow the lists
// his accounts and warehouse teams already work from — a row per person, a row
// per order, and the totals at the top.

const inr = (n: number) => "₹" + (Math.round(n) || 0).toLocaleString("en-IN");
const day = (s: string | null) =>
  s ? formatDate(s) : "—";

type Person = {
  id: string; full_name: string | null; email: string | null; phone: string | null;
  city: string | null; state: string | null; gstin: string | null; business_name: string | null;
  created_at: string; role: string;
};

type Order = {
  id: string; gifter_id: string | null; recipient_name: string | null; recipient_email: string | null;
  recipient_attempt: string | null; tier: string | null; months: number | null;
  amount_inr: number | null; taxable_value: number | null; cgst: number | null; sgst: number | null;
  igst: number | null; invoice_no: string | null; invoice_url: string | null; billing_state: string | null;
  status: string; created_at: string; paid_at: string | null; books_due: boolean | null; tracking_code: string | null;
};

const th: React.CSSProperties = { padding: "7px 9px", textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap", fontWeight: 700 };
const td: React.CSSProperties = { padding: "7px 9px", verticalAlign: "top" };

export default async function SupportersReport(props: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await assertArea("reports");
  const sp = await props.searchParams;
  const from = (sp.from ?? "").trim();
  const to = (sp.to ?? "").trim();

  const svc = createServiceClient();
  const [{ data: peopleRows }, { data: orderRows }] = await Promise.all([
    svc.from("profiles")
      .select("id, full_name, email, phone, city, state, gstin, business_name, created_at, role")
      .eq("is_supporter", true)
      .order("full_name"),
    (() => {
      let q = svc.from("gift_orders")
        .select("id, gifter_id, recipient_name, recipient_email, recipient_attempt, tier, months, amount_inr, taxable_value, cgst, sgst, igst, invoice_no, invoice_url, billing_state, status, created_at, paid_at, books_due, tracking_code")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (from) q = q.gte("created_at", `${from}T00:00:00Z`);
      if (to) q = q.lte("created_at", `${to}T23:59:59Z`);
      return q;
    })(),
  ]);

  const people = (peopleRows ?? []) as Person[];
  const orders = (orderRows ?? []) as Order[];
  const paid = orders.filter((o) => o.status === "provisioned" || o.status === "paid");

  // Per supporter: how many students and how much — the two numbers his
  // accounts team asks for first.
  const byGifter = new Map<string, { n: number; amount: number }>();
  for (const o of paid) {
    if (!o.gifter_id) continue;
    const cur = byGifter.get(o.gifter_id) ?? { n: 0, amount: 0 };
    cur.n += 1;
    cur.amount += Number(o.amount_inr || 0);
    byGifter.set(o.gifter_id, cur);
  }
  const nameById = new Map(people.map((p) => [p.id, p.full_name || p.email || "Supporter"]));
  const totalGiven = paid.reduce((s, o) => s + Number(o.amount_inr || 0), 0);
  const totalTax = paid.reduce((s, o) => s + Number(o.cgst || 0) + Number(o.sgst || 0) + Number(o.igst || 0), 0);

  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ from, to, ...o });
    [...p.entries()].forEach(([k, v]) => { if (!v) p.delete(k); });
    return `/admin/reports/supporters?${p.toString()}`;
  };

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 1150 }}>
      <AdminHero
        badge="💚 Supporters"
        title="Supporters & their orders"
        subtitle="Who sponsors students here, how many each has paid for, and every order with its invoice and GST split."
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <form className="card" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <div><label style={{ fontSize: ".8rem" }}>From date</label><input type="date" name="from" defaultValue={from} style={{ marginBottom: 0 }} /></div>
        <div><label style={{ fontSize: ".8rem" }}>To date</label><input type="date" name="to" defaultValue={to} style={{ marginBottom: 0 }} /></div>
        <button className="btn small" type="submit">Filter</button>
        {(from || to) && <Link className="btn small secondary" href="/admin/reports/supporters">Clear</Link>}
      </form>

      <div className="admin-cards" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <div className="admin-tile"><div className="tile-ic">💚</div><h3 style={{ fontSize: "1.5rem" }}>{people.length}</h3><p>supporters</p></div>
        <div className="admin-tile"><div className="tile-ic">🎓</div><h3 style={{ fontSize: "1.5rem" }}>{paid.length}</h3><p>students sponsored</p></div>
        <div className="admin-tile"><div className="tile-ic">💰</div><h3 style={{ fontSize: "1.5rem" }}>{inr(totalGiven)}</h3><p>received</p></div>
        <div className="admin-tile"><div className="tile-ic">🧾</div><h3 style={{ fontSize: "1.5rem" }}>{inr(totalTax)}</h3><p>GST within it</p></div>
      </div>

      {/* ── Supporters list ─────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 30 }}>💚 Supporters list ({people.length})</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
          <thead><tr>
            <th style={th}>Name</th><th style={th}>Business</th><th style={th}>Email</th><th style={th}>Phone</th>
            <th style={th}>City</th><th style={th}>State</th><th style={th}>GSTIN</th>
            <th style={th}>Students</th><th style={th}>Amount</th><th style={th}>Since</th>
          </tr></thead>
          <tbody>
            {people.length === 0 && (
              <tr><td style={td} colSpan={10}><span className="muted">No supporters yet.</span></td></tr>
            )}
            {people.map((p) => {
              const t = byGifter.get(p.id);
              return (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}><Link href={`/admin/users/${p.id}`}>{p.full_name || "—"}</Link></td>
                  <td style={td}>{p.business_name || "—"}</td>
                  <td style={td}>{p.email || "—"}</td>
                  <td style={td}>{p.phone || "—"}</td>
                  <td style={td}>{p.city || "—"}</td>
                  <td style={td}>{p.state || "—"}</td>
                  <td style={td}>{p.gstin || "—"}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{t?.n ?? 0}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{inr(t?.amount ?? 0)}</td>
                  <td style={td}>{day(p.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Supporter orders ────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 30 }}>🧾 Supporter orders ({orders.length})</h2>
      <p className="muted" style={{ fontSize: ".82rem", marginTop: -4 }}>
        Every sponsorship order in the period, paid or not. The GST columns are the invoice&apos;s own split.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
          <thead><tr>
            <th style={th}>Date</th><th style={th}>Invoice</th><th style={th}>Supporter</th>
            <th style={th}>Student</th><th style={th}>Attempt</th><th style={th}>Plan</th>
            <th style={th}>State</th><th style={th}>Taxable</th><th style={th}>CGST</th>
            <th style={th}>SGST</th><th style={th}>IGST</th><th style={th}>Total</th>
            <th style={th}>Status</th><th style={th}>Books</th><th style={th}>Invoice PDF</th>
          </tr></thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td style={td} colSpan={15}><span className="muted">No orders in this period.</span></td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{day(o.paid_at || o.created_at)}</td>
                <td style={td}>{o.invoice_no || "—"}</td>
                <td style={td}>{o.gifter_id ? (nameById.get(o.gifter_id) ?? "—") : "—"}</td>
                <td style={td}>{o.recipient_name || "—"}<br /><span className="muted">{o.recipient_email}</span></td>
                <td style={td}>{o.recipient_attempt || "—"}</td>
                <td style={td}>{o.tier || "—"}{o.months ? ` · ${o.months}m` : ""}</td>
                <td style={td}>{o.billing_state || "—"}</td>
                <td style={td}>{inr(Number(o.taxable_value || 0))}</td>
                <td style={td}>{inr(Number(o.cgst || 0))}</td>
                <td style={td}>{inr(Number(o.sgst || 0))}</td>
                <td style={td}>{inr(Number(o.igst || 0))}</td>
                <td style={{ ...td, fontWeight: 700 }}>{inr(Number(o.amount_inr || 0))}</td>
                <td style={td}>{o.status}</td>
                <td style={td}>{o.books_due ? (o.tracking_code ? `📦 ${o.tracking_code}` : "⏳ to dispatch") : "—"}</td>
                <td style={td}>{o.invoice_url ? <a href={viaProxy(o.invoice_url)} target="_blank" rel="noopener noreferrer">PDF ↓</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 20 }}>
        Only <strong>paid</strong> orders count in the totals above — an abandoned checkout is not a sponsorship.
      </p>
    </section>
  );
}
