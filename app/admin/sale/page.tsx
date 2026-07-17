import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import SubmitButton from "@/app/components/SubmitButton";
import { updateSale } from "./actions";
import { saleFromSettings } from "@/lib/sale";

export const dynamic = "force-dynamic";

export default async function SalePage() {
  const supabase = createClient();
  const { data } = await supabase.from("site_settings").select("key, value");
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string | null]));
  const live = saleFromSettings(m);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <AdminHero
        badge="🏷️ Sale"
        title="Run a sale"
        subtitle="Set a start and end date and a discount %. During that window every subscription price drops automatically and your sale banners appear on the homepage and plans page — then it switches itself off. 🎉"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Status strip */}
      <div className="card" style={{ marginTop: 8, borderColor: live ? "#16a34a" : "var(--border)" }}>
        {live ? (
          <strong style={{ color: "#16a34a" }}>
            ✅ Sale is LIVE right now — {live.discountPct}% off
            {live.endsAt ? ` · ends ${new Date(live.endsAt).toLocaleString("en-IN")}` : ""}
          </strong>
        ) : (
          <strong className="muted">
            💤 No sale is live right now. Tick “Sale is on”, set the dates and a discount, and Save.
          </strong>
        )}
      </div>

      <form action={updateSale} className="form-card" style={{ marginTop: 20 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
          <input type="checkbox" name="sale_enabled" defaultChecked={(m.get("sale_enabled") ?? "") === "1"} style={{ width: 18, height: 18 }} />
          Sale is on (still only shows inside the dates below)
        </label>

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
          <div>
            <label htmlFor="s-start">Starts</label>
            <input id="s-start" name="sale_start" type="datetime-local" defaultValue={toLocalInput(m.get("sale_start"))} />
          </div>
          <div>
            <label htmlFor="s-end">Ends</label>
            <input id="s-end" name="sale_end" type="datetime-local" defaultValue={toLocalInput(m.get("sale_end"))} />
          </div>
        </div>

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr", marginTop: 14 }}>
          <div>
            <label htmlFor="s-pct">Discount %</label>
            <input id="s-pct" name="sale_discount_pct" type="number" min={0} max={90} defaultValue={m.get("sale_discount_pct") ?? ""} placeholder="e.g. 20" />
          </div>
          <div>
            <label htmlFor="s-head">Headline (shown on the banners)</label>
            <input id="s-head" name="sale_headline" defaultValue={m.get("sale_headline") ?? ""} placeholder="e.g. Foundation Week — 20% off all subjects" />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label htmlFor="s-cta">Banner click link (optional)</label>
          <input id="s-cta" name="sale_cta_url" defaultValue={m.get("sale_cta_url") ?? ""} placeholder="e.g. /learn/…/plans — where the banner should take them" />
        </div>

        <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <strong>🎨 Sale creatives</strong>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 14px" }}>
            Upload wide images. The homepage banner shows across the top of the homepage; the plans banner shows above the pricing cards. Both appear only while the sale is live.
          </p>
          <ImageUpload name="sale_banner_home" defaultValue={m.get("sale_banner_home") ?? ""} folder="sale" label="Homepage sale banner (wide)" />
          <div style={{ marginTop: 18 }} />
          <ImageUpload name="sale_banner_plans" defaultValue={m.get("sale_banner_plans") ?? ""} folder="sale" label="Plans-page sale banner (wide)" />
        </div>

        <div style={{ marginTop: 22 }}>
          <SubmitButton>Save sale</SubmitButton>
        </div>
      </form>
    </section>
  );
}

// site_settings stores whatever the datetime-local input submits (local wall
// time, no timezone). Feed it straight back so the admin sees the same value.
function toLocalInput(v: string | null | undefined): string {
  return (v ?? "").slice(0, 16);
}
