import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { saveGstSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "GST & invoicing — Admin" };

export default async function BillingPage() {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("key, value").in("key", [
    "gst_enabled", "gst_number", "gst_legal_name", "gst_address", "gst_state", "gst_rate", "gst_sac", "gst_inclusive", "invoice_prefix",
  ]);
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const v = (k: string, d = "") => m.get(k) ?? d;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 680 }}>
      <AdminHero badge="🧾 GST & invoicing" title="Invoice settings" subtitle="Used to generate GST-compliant invoices for paid & gifted subscriptions." back={{ href: "/admin", label: "Admin" }} />

      <form action={saveGstSettings} className="form-card" style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" name="gst_enabled" defaultChecked={v("gst_enabled", "1") === "1"} /> We are GST-registered (issue tax invoices with CGST/SGST/IGST)
        </label>
        <p className="muted" style={{ fontSize: ".8rem", margin: "-4px 0 0" }}>
          Off = invoices are a plain &ldquo;Bill of Supply&rdquo; with no tax. GST also needs a GSTIN filled below.
        </p>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>GSTIN</label><input name="gst_number" defaultValue={v("gst_number")} placeholder="e.g. 07ABCDE1234F1Z5" /></div>
          <div><label>Registered state (place of supply base)</label><input name="gst_state" defaultValue={v("gst_state", "Delhi")} placeholder="Delhi" /></div>
        </div>
        <div><label>Legal / business name (invoice header)</label><input name="gst_legal_name" defaultValue={v("gst_legal_name", "CA Parveen Sharma")} /></div>
        <div>
          <label>Registered address (head office — must match your GSTIN)</label>
          <textarea name="gst_address" rows={2} defaultValue={v("gst_address")} placeholder="Registered Head Office: Delhi (as per GSTIN). Operational office: Gurugram." />
          <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0" }}>Your GST registration is in <strong>Delhi</strong> (head office); Gurugram is the operational office. Put the exact Delhi address from your GST certificate here so invoices are valid.</p>
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div><label>GST rate %</label><input name="gst_rate" type="number" step="0.01" defaultValue={v("gst_rate", "18")} /></div>
          <div><label>SAC code</label><input name="gst_sac" defaultValue={v("gst_sac", "999293")} /></div>
          <div><label>Invoice prefix</label><input name="invoice_prefix" defaultValue={v("invoice_prefix", "CAPS/")} /></div>
        </div>
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" name="gst_inclusive" defaultChecked={v("gst_inclusive", "1") === "1"} /> Prices already include GST (extract tax from the price; recommended)
        </label>
        <p className="muted" style={{ fontSize: ".8rem", margin: "-4px 0 0" }}>
          Rule applied automatically: buyer in your state → <strong>CGST + SGST</strong>; buyer in a different state → <strong>IGST</strong>.
        </p>
        <SubmitButton className="btn" savedLabel="✓ Saved">Save invoice settings</SubmitButton>
      </form>
    </section>
  );
}
