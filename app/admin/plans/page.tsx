import { createClient } from "@/lib/supabase/server";
import { DURATIONS, computePrice, durationLabel, formatINR } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";
import { updatePlan } from "./actions";

export default async function PlansPage() {
  const supabase = createClient();
  const { data: plans } = await supabase
    .from("plans")
    .select("id, tier, name, rank, web_price_inr, app_price_inr, is_active")
    .order("rank");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="💳 Plans & pricing"
        title="Plans & pricing"
        subtitle="Set per-month prices — longer durations auto-discount (3mo −5%, 6mo −10%, 12mo −20%). App ≈ 130–140% of web. 💰"
        back={{ href: "/admin", label: "Admin" }}
      />

      <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
        {(plans ?? []).map((p) => (
          <div className="card" key={p.id}>
            <form action={updatePlan}>
              <input type="hidden" name="id" value={p.id} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span className="badge">{p.tier}</span>
                <strong>{p.name}</strong>
                {!p.is_active && <span className="muted">(inactive)</span>}
              </div>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                <div>
                  <label>Name</label>
                  <input name="name" defaultValue={p.name} required />
                </div>
                <div>
                  <label>Web price / month (₹)</label>
                  <input name="web_price_inr" type="number" defaultValue={p.web_price_inr ?? 0} />
                </div>
                <div>
                  <label>App price / month (₹)</label>
                  <input name="app_price_inr" type="number" defaultValue={p.app_price_inr ?? 0} />
                </div>
              </div>
              <label className="remember" style={{ marginTop: 0 }}>
                <input type="checkbox" name="is_active" defaultChecked={p.is_active} /> Active
              </label>

              <div className="muted" style={{ fontSize: ".82rem", marginBottom: 12 }}>
                Web totals:{" "}
                {DURATIONS.map((m, i) => (
                  <span key={m}>
                    {i > 0 ? " · " : ""}
                    {durationLabel(m)} {formatINR(computePrice(p.web_price_inr, m))}
                  </span>
                ))}
              </div>

              <button className="btn small" type="submit">
                Save plan
              </button>
            </form>
          </div>
        ))}
        {(!plans || plans.length === 0) && (
          <p className="muted">No plans found. They are seeded by the initial migration.</p>
        )}
      </div>
    </section>
  );
}
