import { createClient } from "@/lib/supabase/server";
import { formatINR, durationLabel } from "@/lib/pricing";
import { razorpayConfigured } from "@/lib/razorpay";
import ComboCheckout from "./ComboCheckout";

export const dynamic = "force-dynamic";

type ComboRow = {
  id: string;
  title: string;
  description: string | null;
  price_inr: number;
  tier: string;
  months: number;
  combo_items: { subjects: { title: string } | null }[] | null;
};

export default async function CombosPublicPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("combos")
    .select("id, title, description, price_inr, tier, months, combo_items(subjects(title))")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  const combos = (data ?? []) as unknown as ComboRow[];
  const configured = await razorpayConfigured();

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">🎁 Combos</span>
        <h2>Bundle &amp; save</h2>
        <p>Get multiple subjects together at one discounted price.</p>
      </div>

      {combos.length > 0 ? (
        <div className="grid grid-3">
          {combos.map((c) => {
            const subjects = (c.combo_items ?? []).map((i) => i.subjects?.title).filter(Boolean);
            return (
              <div className="plan-card" key={c.id}>
                <div className="tier-name" style={{ fontSize: "1.2rem" }}>{c.title}</div>
                {c.description && <div className="tagline">{c.description}</div>}
                <div className="plan-price">{formatINR(c.price_inr)}</div>
                <div className="plan-permonth">
                  {c.tier} access · {durationLabel(c.months)}
                </div>
                <ul className="feat-list">
                  {subjects.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <ComboCheckout comboId={c.id} configured={configured} />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>📭 No combos available right now.</p>
      )}
    </section>
  );
}
