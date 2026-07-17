import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/pricing";
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

export default async function AdminOrdersPage(
  props: {
    searchParams: Promise<{ dispatch?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data } = await supabase
    .from("book_orders")
    .select("id, amount_inr, status, created_at, guest_contact, ship_to, items")
    .order("created_at", { ascending: false })
    .limit(200);
  const orders = (data ?? []) as unknown as OrderRow[];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🚚 Book orders"
        title="Book orders"
        subtitle="Ship the paid orders, then mark them dispatched. Free shipping across India. 📦"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.dispatch && (
        <div className={`notice ${searchParams.dispatch === "skipped" ? "err" : "ok"}`} style={{ marginTop: 16 }}>
          {searchParams.dispatch === "skipped"
            ? "Email isn't configured yet (set MAILGUN + WAREHOUSE_EMAIL) — nothing was sent."
            : `📧 Dispatch email sent for ${searchParams.dispatch} order(s).`}
        </div>
      )}

      <form action={sendDispatchEmail} style={{ marginTop: 18 }}>
        <button className="btn small" type="submit">
          📧 Email dispatch list to warehouse
        </button>
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
                        <button className="btn small" type="submit">
                          Mark dispatched 🚚
                        </button>
                      </form>
                    )}
                    {o.status === "dispatched" && (
                      <form action={setOrderStatus} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="status" value="delivered" />
                        <button className="btn small" type="submit">
                          Mark delivered ✅
                        </button>
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
