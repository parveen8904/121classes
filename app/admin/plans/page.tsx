import Link from "next/link";
import SubmitButton from "@/app/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/pricing";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { updatePlan, setGoldValidityOptions, saveSubjectPricing } from "./actions";

const TIER_NOTE: Record<string, string> = {
  bronze: "Free for everyone — keep the price at 0.",
  silver: "One flat price applied to any subject (tests + AI doubt-solving), for that subject's validity.",
  gold: "Gold is priced per subject — set it below, under 'What each subject costs'. The figure here is not used.",
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

  const { data: pricedSubjects } = await createServiceClient()
    .from("subjects")
    .select("id, title, gold_price_inr, gold_slabs, silver_slabs, batch_months, batch_price_inr, sale_from, sale_to, validity_months, courses(title)")
    .order("order_index");
  const ladderText = (v: unknown) =>
    Array.isArray(v) ? (v as { upto: number; rate: number }[]).map((s) => `${s.upto}:${s.rate}`).join(", ") : "";

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="💳 Plans & pricing"
        title="Plans & pricing"
        subtitle="Every price, in one place — the tiers below, and what each subject actually costs. 💰"
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
      {/* ── What each subject costs ─────────────────────────────────────────
          This lives HERE, on the pricing page. It used to say "set it on each
          subject's page" and send him to Content & courses — which he asked me
          to change when the ladder was built, and again after the Financial
          Instruments fee appeared not to work. */}
      <h2 className="admin-section-title" style={{ marginTop: 30 }}>💸 What each subject costs</h2>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: -4 }}>
        A <strong>ladder</strong> is <code>months:rate</code> pairs — <code>1:1000, 2:900</code> means ₹1,000 for the
        first month and ₹900 for the second, so two months costs ₹1,900. A ladder always wins over the flat price.
        For a live batch, leave the fixed price blank to charge the ladder for its own length.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {(pricedSubjects ?? []).map((s) => {
          const batchM = Number(s.batch_months) || 0;
          return (
            <form action={saveSubjectPricing} className="card" key={s.id as string} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="id" value={s.id as string} />
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong>{s.title as string}</strong>
                <span className="muted" style={{ fontSize: ".8rem" }}>
                  {(s as { courses?: { title?: string } | null }).courses?.title}
                  {batchM > 0 ? ` · 🔴 live batch, ${batchM} month${batchM === 1 ? "" : "s"}` : ""}
                </span>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                <div>
                  <label style={{ fontSize: ".8rem" }}>🥇 Gold ladder</label>
                  <input name="gold_slabs" defaultValue={ladderText(s.gold_slabs)} placeholder="1:1000, 2:900" style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".8rem" }}>🥈 Silver ladder</label>
                  <input name="silver_slabs" defaultValue={ladderText(s.silver_slabs)} placeholder="blank = none" style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".8rem" }}>Flat Gold ₹ (if no ladder)</label>
                  <input name="gold_price_inr" inputMode="numeric" defaultValue={(s.gold_price_inr as number) ?? ""} placeholder="e.g. 11500" style={{ marginBottom: 0 }} />
                </div>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
                <div>
                  <label style={{ fontSize: ".8rem" }}>🔴 Live-batch months</label>
                  <input name="batch_months" type="number" min={0} max={24} defaultValue={(s.batch_months as number) ?? ""} placeholder="blank = normal" style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".8rem" }}>Fixed batch ₹</label>
                  <input name="batch_price_inr" inputMode="numeric" defaultValue={(s.batch_price_inr as number) ?? ""} placeholder="blank = use ladder" style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".8rem" }}>On sale from</label>
                  <input name="sale_from" type="date" defaultValue={(s.sale_from as string) ?? ""} style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".8rem" }}>On sale until</label>
                  <input name="sale_to" type="date" defaultValue={(s.sale_to as string) ?? ""} style={{ marginBottom: 0 }} />
                </div>
              </div>
              <div><SubmitButton className="btn small" savedLabel="✓ Saved">Save price</SubmitButton></div>
            </form>
          );
        })}
      </div>

    </section>
  );
}
