import { formatDate } from "@/lib/dates";
import Link from "next/link";
import SetPassword from "@/app/dashboard/set-password";
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
    .select("full_name, business_name, designation, email, phone, gstin, address_line1, address_line2, city, state, pincode, is_supporter, role, supporter_site, supporter_site_ok_at")
    .eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin" && me?.role !== "supporter") redirect("/dashboard");

  // Made on their first visit if they do not have one yet, so a vendor added
  // this morning has a code by the time they look for it.
  const { ensureSupporterCoupon } = await import("@/lib/supporterCoupon");
  const coupon = await ensureSupporterCoupon(user.id);

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

        {/* SET / CHANGE PASSWORD, RIGHT HERE. His ask, 28 Aug 2026: the reset
            email does not always arrive, and a supporter locked to a mail they
            cannot receive has no other door. This is the same card students
            have on their dashboard — it changes only the signed-in account's
            own password, through their own session, so being here is the
            authorisation. */}
        <div style={{ marginTop: 18 }}>
          <SetPassword />
        </div>

        {/* THEIR TRADING PRICE, NOT A PROMOTION.
            Shown openly because it cannot be used by anybody else: it only
            works on an order placed for a student, and only while signed in as
            this account. A code that is useless to a stranger is not a secret. */}
        {coupon && (
          <div className="card" style={{ marginTop: 18, border: "2px solid var(--accent)" }}>
            <h2 style={{ marginTop: 0, fontSize: "1.02rem" }}>🏷️ Your discount code</h2>
            <p className="muted" style={{ fontSize: ".88rem", lineHeight: 1.7, marginTop: 0 }}>
              You buy at{" "}
              <strong>
                {coupon.percentOff != null
                  ? `${coupon.percentOff}% off`
                  : `₹${(coupon.amountOffInr ?? 0).toLocaleString("en-IN")} off`}
              </strong>{" "}
              the published price and sell at the published price — the difference is yours. Use it as often as you
              like; there is no limit and no expiry.
            </p>
            <p style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "1.4rem", fontWeight: 800, letterSpacing: ".06em",
              background: "var(--bg-soft)", border: "1px dashed var(--accent)", borderRadius: 12,
              padding: "12px 16px", textAlign: "center", margin: "6px 0 10px", wordBreak: "break-all",
            }}>
              {coupon.code}
            </p>
            <p className="muted" style={{ fontSize: ".82rem", lineHeight: 1.7, margin: 0 }}>
              It is already filled in for you when you place an order, so you do not need to remember it. It works
              only on orders you place for a student, and only while you are signed in as yourself — so it is no use
              to anybody else, and nothing is lost if a student sees it.
            </p>
            {/* TO THE SHELF, NOT STRAIGHT INTO THE FORM.
                This used to open the order form directly, where the course and
                the term are typed rather than chosen — and a vendor selling
                both CA Final and CA Intermediate can pick the wrong one without
                anything on the screen contradicting them. Going by way of the
                desk means the course is chosen from the cards, with its level
                and price written on it, before any student's name is typed. */}
            <Link className="btn small" href="/supporter" style={{ marginTop: 12 }}>Place an order →</Link>
          </div>
        )}

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
              {/* WHO WE ARE ACTUALLY DEALING WITH.
                  A shop name is not a person. When an invoice has to be
                  queried, or a page on their site has to be corrected, the
                  office needs to know whether they are speaking to the owner
                  or to somebody at a counter. Suggested, not restricted —
                  every business names its own roles differently. */}
              <label htmlFor="designation">Your designation</label>
              <input
                id="designation"
                name="designation"
                list="designations"
                defaultValue={me?.designation ?? ""}
                placeholder="e.g. Proprietor"
              />
              <datalist id="designations">
                <option value="Proprietor" />
                <option value="Partner" />
                <option value="Director" />
                <option value="Manager" />
                <option value="Owner" />
              </datalist>
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
          {/* A stray "Billing address" label used to sit here, with no field
              under it — the address itself is further down, under its own
              heading. It read as a box that had failed to render, and clicking
              it threw the cursor half a page away. */}
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
              ✅ Verified as yours on {formatDate(siteOk)}.
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

          {/* "WHERE BOOKS SHOULD BE SENT" WAS ASKED HERE AND USED NOWHERE.
              Books go to the STUDENT, at the address the vendor types when they
              place that order — a different address every time. This box was
              saved to the profile and never read by an order, a label or the
              warehouse. Nobody had filled it in, which is lucky: anybody who
              had would have been waiting for a parcel that was never coming
              here. The vendor's own address above is for their INVOICE. */}

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
