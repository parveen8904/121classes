import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { saveSupporterProfile, verifySupporterSite } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "My details — Supporter" };

const STATES = ["Delhi", "Haryana", "Uttar Pradesh", "Punjab", "Rajasthan", "Maharashtra", "Gujarat", "Karnataka", "Tamil Nadu", "Telangana", "West Bengal", "Bihar", "Madhya Pradesh", "Kerala", "Andhra Pradesh", "Uttarakhand", "Himachal Pradesh", "Jharkhand", "Chhattisgarh", "Odisha", "Assam", "Goa", "Chandigarh", "Jammu and Kashmir", "Other"];

// A supporter's own details — asked once, then used on every invoice.
//
// Not the student profile: no attempt, no target exam, no study plan. A
// supporter needs a phone number we can reach them on, an email for their
// invoices, and the billing details that decide what tax appears on them.
export default async function SupporterProfilePage(props: {
  searchParams: Promise<{ saved?: string; next?: string; err?: string; verified?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter/profile");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles")
    .select("full_name, business_name, email, phone, gstin, address_line1, address_line2, city, state, pincode, is_supporter, role, supporter_site, supporter_site_ok_at, supporter_ship_to")
    .eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin" && me?.role !== "supporter") redirect("/dashboard");

  const { siteToken } = await import("@/lib/supporterSite");
  const token = siteToken(user.id);
  const siteOk = (me as { supporter_site_ok_at?: string | null } | null)?.supporter_site_ok_at ?? null;

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 640 }}>
        <p className="crumb" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Link href="/supporter">← My desk</Link>
          <a href="/auth/signout" style={{ fontSize: ".85rem" }}>Log out</a>
        </p>
        <span className="badge">👤 My details</span>
        <h1 style={{ margin: "12px 0 6px" }}>Your details</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          These go on your invoices. Fill them once and every order afterwards carries them.
        </p>

        {sp.saved && <div className="notice ok" style={{ marginTop: 14 }}>✅ Saved.</div>}

        {sp.err && <div className="notice err" style={{ marginTop: 12 }}>⚠️ {sp.err}</div>}
        {sp.verified === "1" && <div className="notice ok" style={{ marginTop: 12 }}>✅ Your website is verified.</div>}

        <form action={saveSupporterProfile} className="card" style={{ marginTop: 18 }}>
          <input type="hidden" name="next" value={sp.next ?? ""} />

          <h2 style={{ marginTop: 0, fontSize: "1.02rem" }}>How we reach you</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <div>
              <label htmlFor="full_name">Your name</label>
              <input id="full_name" name="full_name" defaultValue={me?.full_name ?? ""} required />
            </div>
            <div>
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" defaultValue={me?.phone ?? ""} placeholder="10-digit mobile" />
            </div>
            <div>
              <label htmlFor="email">Email (invoices come here)</label>
              <input id="email" name="email" type="email" defaultValue={me?.email ?? ""} />
            </div>
          </div>

          <h2 style={{ fontSize: "1.02rem", marginTop: 18 }}>Billing</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <div>
              <label htmlFor="business_name">Business name (if you invoice as a firm)</label>
              <input id="business_name" name="business_name" defaultValue={me?.business_name ?? ""} />
            </div>
            <div>
              <label htmlFor="gstin">GSTIN (optional)</label>
              <input id="gstin" name="gstin" defaultValue={me?.gstin ?? ""} placeholder="15-digit GSTIN" />
            </div>
          </div>
          <label htmlFor="address_line1">Billing address</label>
          {/* THE SHOPFRONT. Mandatory, because a reseller with nowhere to sell
              is somebody we cannot check — and everything in the agreement is
              about what appears on this page. */}
          <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>Where you sell</h2>
          <label htmlFor="site">Your website <span style={{ color: "#b91c1c" }}>*</span></label>
          <input
            id="site"
            name="supporter_site"
            defaultValue={(me as { supporter_site?: string } | null)?.supporter_site ?? ""}
            placeholder="https://yourinstitute.com"
            required
          />
          <p className="muted" style={{ fontSize: ".8rem", marginTop: -2 }}>
            The site you sell these courses from. We check it from time to time — that the price is
            honoured, and that the courses are not bundled with another teacher&apos;s.
          </p>

          {siteOk ? (
            <div className="notice ok" style={{ fontSize: ".85rem" }}>
              ✅ Verified as yours on {new Date(siteOk).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.
            </div>
          ) : (
            <div className="card" style={{ background: "var(--bg-soft)", fontSize: ".85rem" }}>
              <strong>Prove the site is yours</strong>
              <p style={{ margin: "6px 0", lineHeight: 1.7 }}>
                Put this code anywhere on your homepage — in the footer, or an HTML comment. Nobody
                but you can publish to your own site, which is what makes it proof.
              </p>
              <code style={{ display: "inline-block", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: ".95rem" }}>
                {token}
              </code>
              <p className="muted" style={{ margin: "8px 0 0", fontSize: ".78rem" }}>
                Save this page first, publish the code, then press Check below. You can remove it
                afterwards if you prefer.
              </p>
            </div>
          )}

          <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>Billing address</h2>
          <input id="address_line1" name="address_line1" defaultValue={me?.address_line1 ?? ""} placeholder="Building, street" />
          <input name="address_line2" defaultValue={me?.address_line2 ?? ""} placeholder="Area, landmark (optional)" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <div><label htmlFor="city">City</label><input id="city" name="city" defaultValue={me?.city ?? ""} /></div>
            <div><label htmlFor="pincode">PIN code</label><input id="pincode" name="pincode" defaultValue={me?.pincode ?? ""} /></div>
            <div>
              <label htmlFor="state">State</label>
              {/* The state decides whether your invoice carries CGST + SGST or
                  IGST, so it is the one field here that is not optional. */}
              <select id="state" name="state" defaultValue={me?.state ?? "Delhi"} required>
                {STATES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          </div>

          <h2 style={{ fontSize: "1.05rem", marginTop: 18 }}>Where books should be sent</h2>
          <label htmlFor="ship">Shipping address, if different from the billing address above</label>
          <textarea
            id="ship"
            name="supporter_ship_to"
            rows={2}
            defaultValue={(me as { supporter_ship_to?: string } | null)?.supporter_ship_to ?? ""}
            placeholder="Leave blank to use the billing address"
            style={{ width: "100%", background: "var(--bg-soft)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", fontFamily: "inherit" }}
          />

          <SubmitButton className="btn" savedLabel="✓ Saved">💾 Save my details</SubmitButton>
        </form>

        {/* Its own form, standing AFTER the profile form — never inside it. A
            form within a form is invalid HTML and takes the whole page down. */}
        {!siteOk && (
          <form action={verifySupporterSite} style={{ marginTop: 12 }}>
            <SubmitButton className="btn secondary" savedLabel="Checked">🔎 Check my website now</SubmitButton>
            <p className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
              Save your details first, publish the code on your site, then press this.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
