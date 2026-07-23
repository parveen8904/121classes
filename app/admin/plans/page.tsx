import Link from "next/link";
import SubmitButton from "@/app/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";
import { updatePlan, setGoldValidityOptions } from "./actions";

const TIER_NOTE: Record<string, string> = {
  bronze: "Free for everyone — keep the price at 0.",
  silver: "One flat price applied to any subject (tests + AI doubt-solving), for that subject's validity.",
  gold: "⚠️ Gold is priced per subject — set it on each subject's page (Admin → Courses → subject). The price below is NOT used.",
};

export default async function PlansPage() {
  const supabase = createClient();
  const [{ data: plans }, { data: validity }] = await Promise.all([
    supabase
      .from("plans")
      .select("id, tier, name, rank, web_price_inr, app_price_inr, is_active")
      .order("rank"),
    supabase.from("site_settings").select("value").eq("key", "gold_validity_options").maybeSingle(),
  ]);
  const goldValidity = (validity?.value as string) ?? "1,2,3,6,12,18,24";

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="💳 Plans & pricing"
        title="Plans & pricing"
        subtitle="This page defines the TIERS (names, active on/off, Silver's flat price, gift pricing). The actual Gold AMOUNTS now come from each subject's 💸 Duration price ladder (Admin → Courses → subject) — a ladder always overrides what's here. 💰"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Gold validity options shown to students */}
      <div className="form-card" style={{ marginTop: 24 }}>
        <h3>⏳ Gold validity options</h3>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: -4, marginBottom: 10 }}>
          FALLBACK only: used when a subject has no Duration price ladder. Subjects WITH a ladder show the
          ladder&apos;s own month choices (1/3/6/12/24) automatically.
        </p>
        <form action={setGoldValidityOptions} style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label>Validity months</label>
            <input name="gold_validity_options" defaultValue={goldValidity} style={{ marginBottom: 0 }} />
          </div>
          <SubmitButton className="btn small">
            Save
          </SubmitButton>
        </form>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
        {(plans ?? []).map((p) => {
          const isGold = p.tier === "gold";
          const isBronze = p.tier === "bronze";
          return (
            <div className="card" key={p.id}>
              <form action={updatePlan}>
                <input type="hidden" name="id" value={p.id} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span className="badge">{p.tier}</span>
                  <strong>{p.name}</strong>
                  {!p.is_active && <span className="muted">(inactive)</span>}
                </div>
                <p className="muted" style={{ fontSize: ".82rem", marginBottom: 12 }}>
                  {TIER_NOTE[p.tier]}
                  {isGold && (
                    <>
                      {" "}
                      <Link href="/admin/courses">Manage subjects →</Link>
                    </>
                  )}
                </p>

                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                  <div>
                    <label>Name</label>
                    <input name="name" defaultValue={p.name} required />
                  </div>
                  <div>
                    <label>Price (₹){isBronze || isGold ? "" : " — flat"}</label>
                    <input
                      name="web_price_inr"
                      type="number"
                      min={0}
                      defaultValue={p.web_price_inr ?? 0}
                      disabled={isGold}
                      style={isGold ? { opacity: 0.5 } : undefined}
                    />
                  </div>
                  <div>
                    <label>App price (₹) — future</label>
                    <input name="app_price_inr" type="number" min={0} defaultValue={p.app_price_inr ?? 0} />
                  </div>
                </div>
                <label className="remember" style={{ marginTop: 0 }}>
                  <input type="checkbox" name="is_active" defaultChecked={p.is_active} /> Active
                </label>

                {!isBronze && !isGold && (
                  <div className="muted" style={{ fontSize: ".82rem", marginBottom: 12 }}>
                    Students pay {formatINR(p.web_price_inr ?? 0)} once, for the subject&apos;s validity period.
                  </div>
                )}

                <SubmitButton className="btn small">
                  Save plan
                </SubmitButton>
              </form>
            </div>
          );
        })}
        {(!plans || plans.length === 0) && (
          <p className="muted">No plans found. They are seeded by the initial migration.</p>
        )}
      </div>
    </section>
  );
}
