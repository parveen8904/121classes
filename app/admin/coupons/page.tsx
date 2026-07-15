import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import SubmitButton from "@/app/components/SubmitButton";
import { createCoupon, deleteCoupon, toggleCoupon, emailCoupon, editCoupon } from "./actions";

export default async function CouponsPage({ searchParams }: { searchParams: { mail?: string } }) {
  const supabase = createClient();
  const { data: coupons } = await supabase
    .from("coupons")
    .select("id, code, percent_off, amount_off_inr, is_active, max_uses, used_count, scope, for_email, expires_at")
    .order("created_at", { ascending: false });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🏷️ Coupons"
        title="Discount coupons"
        subtitle="Run offers like the competition — percentage or flat-amount codes applied at checkout. 💸"
        back={{ href: "/admin", label: "Admin" }}
      />
      {searchParams.mail === "sent" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Coupon emailed with the Sponsor Guide attached.</div>}
      {searchParams.mail === "edited" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Coupon updated.</div>}
      {searchParams.mail === "fail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Couldn&apos;t send — check the email address and that Mailgun is set up.</div>}
      {searchParams.mail === "bademail" && <div className="notice err" style={{ marginTop: 16 }}>Enter a valid email address.</div>}

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
              <input name="max_uses" type="number" placeholder="blank = ∞, 1 = once" />
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
            <div>
              <label>Applies to</label>
              <select name="scope" defaultValue="any">
                <option value="any">Anyone (users &amp; gifters)</option>
                <option value="user">Users buying for themselves</option>
                <option value="donor">Gifters (gift purchases)</option>
              </select>
            </div>
            <div>
              <label>Expires on (blank = never)</label>
              <input name="expires_at" type="date" />
            </div>
            <div>
              <label>Lock to one email (optional)</label>
              <input name="for_email" type="email" placeholder="blank = anyone" />
            </div>
          </div>
          <label className="remember" style={{ marginTop: 8 }}>
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
            <div className="list-row" key={c.id} style={{ flexWrap: "wrap" }}>
              <div>
                <span className="row-title">🏷️ {c.code}</span>
                <p className="row-sub">
                  {c.percent_off ? `${c.percent_off}% off` : c.amount_off_inr ? `₹${c.amount_off_inr} off` : "—"} ·{" "}
                  {c.is_active ? "🟢 active" : "⚪ off"} · used {c.used_count}
                  {c.max_uses ? ` / ${c.max_uses}` : ""}
                  {(c as { scope?: string }).scope && (c as { scope?: string }).scope !== "any" ? ` · ${(c as { scope?: string }).scope === "donor" ? "🎁 gifters only" : "👤 users only"}` : ""}
                  {(c as { for_email?: string | null }).for_email ? ` · 🔒 ${(c as { for_email?: string }).for_email}` : ""}
                  {(c as { expires_at?: string | null }).expires_at ? ` · ⏳ till ${new Date((c as { expires_at?: string }).expires_at!).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                </p>
              </div>
              <div className="row-actions" style={{ flexWrap: "wrap" }}>
                <form action={emailCoupon} style={{ margin: 0, display: "flex", gap: 4 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input name="to" type="email" placeholder="email to sponsor…" style={{ width: 170, fontSize: ".82rem" }} required />
                  <SubmitButton className="btn small">✉️ Send</SubmitButton>
                </form>
                <form action={toggleCoupon} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="next" value={c.is_active ? "false" : "true"} />
                  <button className="btn small secondary" type="submit">
                    {c.is_active ? "Disable" : "Enable"}
                  </button>
                </form>
                <DeleteButton action={deleteCoupon} id={c.id} message="Delete this coupon?" />
              </div>
              <details style={{ marginTop: 8, flexBasis: "100%" }}>
                <summary style={{ cursor: "pointer", fontSize: ".82rem", color: "var(--accent)" }}>✏️ Edit coupon</summary>
                <form action={editCoupon} style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                    <div><label>Code</label><input name="code" defaultValue={c.code} /></div>
                    <div><label>% off</label><input name="percent_off" type="number" defaultValue={c.percent_off ?? ""} /></div>
                    <div><label>OR ₹ off</label><input name="amount_off_inr" type="number" defaultValue={c.amount_off_inr ?? ""} /></div>
                    <div><label>Max uses</label><input name="max_uses" type="number" defaultValue={c.max_uses ?? ""} placeholder="blank = ∞" /></div>
                  </div>
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
                    <div>
                      <label>Applies to</label>
                      <select name="scope" defaultValue={(c as { scope?: string }).scope ?? "any"}>
                        <option value="any">Anyone (users &amp; gifters)</option>
                        <option value="user">Users buying for themselves</option>
                        <option value="donor">Gifters (gift purchases)</option>
                      </select>
                    </div>
                    <div>
                      <label>Expires on (blank = never)</label>
                      <input name="expires_at" type="date" defaultValue={(c as { expires_at?: string | null }).expires_at ? new Date((c as { expires_at?: string }).expires_at!).toISOString().slice(0, 10) : ""} />
                    </div>
                    <div>
                      <label>Lock to one email (optional)</label>
                      <input name="for_email" type="email" defaultValue={(c as { for_email?: string | null }).for_email ?? ""} placeholder="blank = anyone" />
                    </div>
                  </div>
                  <label className="remember" style={{ marginTop: 8 }}>
                    <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> Active
                  </label>
                  <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginLeft: 8 }}>Save changes</SubmitButton>
                </form>
              </details>
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
