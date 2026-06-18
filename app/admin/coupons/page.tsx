import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import { createCoupon, deleteCoupon, toggleCoupon } from "./actions";

export default async function CouponsPage() {
  const supabase = createClient();
  const { data: coupons } = await supabase
    .from("coupons")
    .select("id, code, percent_off, amount_off_inr, is_active, max_uses, used_count")
    .order("created_at", { ascending: false });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🏷️ Coupons"
        title="Discount coupons"
        subtitle="Run offers like the competition — percentage or flat-amount codes applied at checkout. 💸"
        back={{ href: "/admin", label: "Admin" }}
      />

      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ New coupon</summary>
        <div style={{ marginTop: 12, width: "100%" }}><div className="form-card" style={{ marginTop: 24 }}>
        <h3>➕ Add a coupon</h3>
        <form action={createCoupon}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            <div>
              <label>Code</label>
              <input name="code" placeholder="e.g. EARLY50" required />
            </div>
            <div>
              <label>% off</label>
              <input name="percent_off" type="number" placeholder="50" />
            </div>
            <div>
              <label>OR ₹ off</label>
              <input name="amount_off_inr" type="number" placeholder="500" />
            </div>
            <div>
              <label>Max uses</label>
              <input name="max_uses" type="number" placeholder="blank = ∞" />
            </div>
          </div>
          <label className="remember" style={{ marginTop: 0 }}>
            <input type="checkbox" name="is_active" defaultChecked /> Active
          </label>
          <button className="btn" type="submit">
            Add coupon
          </button>
        </form>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 8 }}>
          Set either a % discount or a flat ₹ amount (% wins if both are filled).
        </p>
      </div></div>
      </details>

      <h2 className="admin-section-title">🏷️ All coupons</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {coupons && coupons.length > 0 ? (
          coupons.map((c) => (
            <div className="list-row" key={c.id}>
              <div>
                <span className="row-title">🏷️ {c.code}</span>
                <p className="row-sub">
                  {c.percent_off ? `${c.percent_off}% off` : c.amount_off_inr ? `₹${c.amount_off_inr} off` : "—"} ·{" "}
                  {c.is_active ? "🟢 active" : "⚪ off"} · used {c.used_count}
                  {c.max_uses ? ` / ${c.max_uses}` : ""}
                </p>
              </div>
              <div className="row-actions">
                <form action={toggleCoupon} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="next" value={c.is_active ? "false" : "true"} />
                  <button className="btn small secondary" type="submit">
                    {c.is_active ? "Disable" : "Enable"}
                  </button>
                </form>
                <DeleteButton action={deleteCoupon} id={c.id} message="Delete this coupon?" />
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No coupons yet — add your first above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
