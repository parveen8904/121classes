import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { formatINR } from "@/lib/pricing";
import { viaProxy } from "@/lib/fileProxy";
import AdminHero from "../_components/AdminHero";
import { setOrderStatus, sendDispatchEmail } from "./actions";

type Ship = { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; phone?: string };
type Contact = { name?: string; email?: string; phone?: string };
type Item = { book_id?: string; qty?: number; price_inr?: number };
type OrderRow = {
  id: string;
  amount_inr: number;
  status: string;
  created_at: string;
  guest_contact: Contact | null;
  ship_to: Ship | null;
  items: Item[] | null;
};

const STATUS_EMOJI: Record<string, string> = {
  paid: "🟡 paid",
  dispatched: "🚚 dispatched",
  delivered: "✅ delivered",
  cancelled: "❌ cancelled",
};

function fmt(s: string): string {
  return new Date(s).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

type PayRow = {
  id: string; kind: string; amount_inr: number; status: string; created_at: string;
  razorpay_order_id: string | null; invoice_no: string | null; invoice_url: string | null;
  profiles: { full_name: string | null; email: string | null; phone: string | null } | null;
};

export default async function AdminOrdersPage(
  props: {
    searchParams: Promise<{ dispatch?: string; q?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const supabase = createClient();
  const svc = createServiceClient();

  const [{ data }, { data: payData }] = await Promise.all([
    supabase
      .from("book_orders")
      .select("id, amount_inr, status, created_at, guest_contact, ship_to, items, invoice_no, invoice_url")
      .order("created_at", { ascending: false })
      .limit(200),
    // ALL website payments (subscriptions / extensions / gifts) — OUR sales register.
    svc
      .from("orders")
      .select("id, kind, amount_inr, status, created_at, razorpay_order_id, invoice_no, invoice_url, profiles:student_id(full_name, email, phone)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const match = (parts: (string | null | undefined)[]) => !q || parts.some((p) => (p ?? "").toLowerCase().includes(q));
  const orders = ((data ?? []) as unknown as (OrderRow & { invoice_no?: string | null; invoice_url?: string | null })[])
    .filter((o) => match([o.guest_contact?.name, o.guest_contact?.email, o.guest_contact?.phone, o.ship_to?.name, o.ship_to?.phone, o.invoice_no]));
  const payments = ((payData ?? []) as unknown as PayRow[])
    .filter((p) => match([p.profiles?.full_name, p.profiles?.email, p.profiles?.phone, p.invoice_no, p.razorpay_order_id]));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="💳 Sales & orders"
        title="Sales & orders"
        subtitle="Every payment — subscriptions, extensions and books — with GST invoices, plus book dispatching. 📦"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Search everything on this page */}
      <form style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 520 }}>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="🔍 Search name, email, phone, invoice no…" style={{ marginBottom: 0 }} />
          <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
        </div>
      </form>

      {/* Website payments register — OUR sales only (from our own database).
          Razorpay account data lives on its own page: the same Razorpay key is
          used by other businesses too, so it is NOT our sales register. */}
      <h2 className="admin-section-title" style={{ marginTop: 22 }}>💳 Website payments — subscriptions &amp; extensions ({payments.length})</h2>
      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>
            Sales made through this website only — the register you verify Razorpay against.
          </p>
          <span style={{ display: "inline-flex", gap: 8 }}>
            <a className="btn small" href="/admin/orders/export">⬇️ Download Excel (CSV)</a>
            <a className="btn small secondary" href="/admin/orders/razorpay">📈 Razorpay account data</a>
          </span>
        </div>
        {payments.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "6px 8px" }}>Date</th><th style={{ padding: "6px 8px" }}>Payer</th>
                  <th style={{ padding: "6px 8px" }}>Type</th><th style={{ padding: "6px 8px" }}>Amount</th>
                  <th style={{ padding: "6px 8px" }}>Status</th><th style={{ padding: "6px 8px" }}>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.created_at)}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <strong>{p.profiles?.full_name ?? "—"}</strong>
                      <div className="muted" style={{ fontSize: ".76rem" }}>{p.profiles?.email ?? ""}{p.profiles?.phone ? ` · ${p.profiles.phone}` : ""}</div>
                    </td>
                    <td style={{ padding: "6px 8px" }}>{p.kind}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{formatINR(p.amount_inr)}</td>
                    <td style={{ padding: "6px 8px" }}>{p.status === "paid" ? "✅ paid" : p.status}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {p.invoice_url
                        ? <a className="grad" href={viaProxy(p.invoice_url)} target="_blank" rel="noopener noreferrer">{p.invoice_no ?? "PDF"} ↓</a>
                        : (p.invoice_no ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>{q ? "No payments match your search." : "No payments yet."}</p>
        )}
      </div>
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
        Invoices are emailed to the payer automatically on payment and stored privately — students never see them
        inside their login. Gift invoices remain on <a href="/admin/reports" className="grad">Reports</a>.
      </p>

      <h2 className="admin-section-title" style={{ marginTop: 26 }}>🚚 Book orders ({orders.length})</h2>

      {searchParams.dispatch && (
        <div className={`notice ${searchParams.dispatch === "skipped" ? "err" : "ok"}`} style={{ marginTop: 16 }}>
          {searchParams.dispatch === "skipped"
            ? "Email isn't configured yet (set MAILGUN + WAREHOUSE_EMAIL) — nothing was sent."
            : `📧 Dispatch email sent for ${searchParams.dispatch} order(s).`}
        </div>
      )}

      <form action={sendDispatchEmail} style={{ marginTop: 18 }}>
        <SubmitButton className="btn small">
          📧 Email dispatch list to warehouse
        </SubmitButton>
        <span className="muted" style={{ fontSize: ".8rem", marginLeft: 10 }}>
          Also runs automatically each evening.
        </span>
      </form>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        {orders.length > 0 ? (
          orders.map((o) => {
            const qty = (o.items ?? []).reduce((s, i) => s + (i.qty ?? 0), 0);
            const ship = o.ship_to ?? {};
            return (
              <div className="card" key={o.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>
                      {o.guest_contact?.name ?? ship.name ?? "Customer"} · {formatINR(o.amount_inr)}
                    </strong>
                    <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                      {qty} item{qty === 1 ? "" : "s"} · {STATUS_EMOJI[o.status] ?? o.status} · {fmt(o.created_at)}
                      {o.invoice_url && <> · <a className="grad" href={viaProxy(o.invoice_url)} target="_blank" rel="noopener noreferrer">🧾 {o.invoice_no ?? "Invoice"} ↓</a></>}
                    </p>
                    <p className="muted" style={{ fontSize: ".82rem", marginTop: 6 }}>
                      📍 {ship.line1}
                      {ship.line2 ? `, ${ship.line2}` : ""}, {ship.city}, {ship.state} {ship.pincode} ·
                      📞 {ship.phone ?? o.guest_contact?.phone} · ✉️ {o.guest_contact?.email}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    {o.status === "paid" && (
                      <form action={setOrderStatus} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="status" value="dispatched" />
                        <SubmitButton className="btn small">
                          Mark dispatched 🚚
                        </SubmitButton>
                      </form>
                    )}
                    {o.status === "dispatched" && (
                      <form action={setOrderStatus} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="status" value="delivered" />
                        <SubmitButton className="btn small">
                          Mark delivered ✅
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="card">
            <p className="muted">📭 No book orders yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}
