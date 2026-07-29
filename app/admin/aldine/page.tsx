import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { saveAldineMapping, deleteAldineMapping, retryUnmapped } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aldine bridge — Admin" };

// Courses sold on aldine.edu.in (WooCommerce) are opened here automatically.
// This page holds the product → course mapping and shows every order that has
// come across the bridge.

const fmt = (v: string) =>
  new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function AldineAdmin(props: {
  searchParams: Promise<{ saved?: string; removed?: string; retried?: string; err?: string }>;
}) {
  const sp = await props.searchParams;
  const svc = createServiceClient();

  const [{ data: mappings }, { data: orders }, { data: courses }, { data: subjects }, secret] = await Promise.all([
    svc.from("partner_products").select("*").eq("source", "aldine").order("created_at"),
    svc.from("partner_orders").select("*").eq("source", "aldine").order("created_at", { ascending: false }).limit(60),
    svc.from("courses").select("id, title").eq("is_published", true).order("order_index"),
    svc.from("subjects").select("id, title, course_id").order("title"),
    getSecret("ALDINE_WEBHOOK_SECRET"),
  ]);
  const courseTitle = new Map((courses ?? []).map((c) => [c.id as string, c.title as string]));
  const subjectTitle = new Map((subjects ?? []).map((s) => [s.id as string, s.title as string]));
  const configured = Boolean((secret ?? "").trim());
  const unmapped = (orders ?? []).filter((o) => o.status === "unmapped").length;

  const STATUS: Record<string, string> = { granted: "✅ granted", unmapped: "⚠️ unmapped", error: "❌ error", received: "⏳ received" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 980 }}>
      <AdminHero
        badge="🌉 Aldine bridge"
        title="Sell on Aldine, study here"
        subtitle="A purchase on aldine.edu.in creates the account here, opens the course, and emails the student their login — automatically. 🎓"
        back={{ href: "/admin", label: "Admin" }}
      />

      {sp.saved && <div className="notice ok" style={{ marginTop: 16 }}>✓ Mapping saved — the next order for that product provisions automatically.</div>}
      {sp.removed && <div className="notice ok" style={{ marginTop: 16 }}>✓ Mapping removed.</div>}
      {sp.retried && <div className="notice ok" style={{ marginTop: 16 }}>✓ Retried — {sp.retried} order(s) granted.</div>}
      {sp.err && <div className="notice err" style={{ marginTop: 16 }}>Product ID and course are both needed.</div>}

      {/* Setup state + instructions */}
      <div className="card" style={{ marginTop: 16 }}>
        <strong>{configured ? "🟢 Bridge key is set" : "🔴 One-time setup needed"}</strong>
        <ol style={{ fontSize: ".86rem", margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            {configured ? "Done — " : ""}On <strong>Integrations</strong>, set <em>Aldine bridge secret</em> to a long
            random text{configured ? " (already set)" : ""}.
          </li>
          <li>
            On <strong>aldine.edu.in</strong>: WP Admin → WooCommerce → Settings → Advanced → <strong>Webhooks</strong> →
            Add webhook:
            <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "8px 12px", margin: "6px 0", fontSize: ".82rem" }}>
              Name: <code>caparveensharma bridge</code> · Status: <code>Active</code> · Topic: <code>Order updated</code><br />
              Delivery URL: <code>https://caparveensharma.com/api/partner/aldine</code><br />
              Secret: <em>the same text as step 1</em> · API version: <code>WP REST API Integration v3</code>
            </div>
          </li>
          <li>Map each Aldine product below (the product ID is the number shown in WooCommerce → Products when you hover a product, or in its edit-page address).</li>
          <li>Place a ₹1 test order on Aldine (or use a 100% coupon) and watch it appear in the log below.</li>
        </ol>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 8, marginBottom: 0 }}>
          Only paid orders provision (status processing/completed). A student who buys gets ONE email: new people a
          set-password button, existing students a login button — then the welcome guide after first login. Webhook
          retries can never grant twice.
        </p>
      </div>

      {/* Mappings */}
      <div className="form-card" style={{ marginTop: 16 }}>
        <h3>🗺️ Product mappings</h3>
        {(mappings ?? []).length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem", marginBottom: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "4px 8px" }}>Aldine product</th>
                <th style={{ padding: "4px 8px" }}>Opens here</th>
                <th style={{ padding: "4px 8px" }}>Tier</th>
                <th style={{ padding: "4px 8px" }}>Months</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(mappings ?? []).map((m) => (
                <tr key={m.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px" }}><strong>#{m.product_key as string}</strong>{m.label ? ` — ${m.label as string}` : ""}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {courseTitle.get(m.course_id as string) ?? "?"}
                    {m.subject_id ? ` — ${subjectTitle.get(m.subject_id as string) ?? "?"}` : " (whole course)"}
                  </td>
                  <td style={{ padding: "6px 8px", textTransform: "capitalize" }}>{m.tier as string}</td>
                  <td style={{ padding: "6px 8px" }}>{m.months as number}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <form action={deleteAldineMapping}>
                      <input type="hidden" name="id" value={m.id as string} />
                      <button className="btn small ghost" type="submit">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={saveAldineMapping} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", alignItems: "end" }}>
          <div>
            <label>Aldine product ID *</label>
            <input name="product_key" placeholder="e.g. 1234" required />
          </div>
          <div>
            <label>Label (for you)</label>
            <input name="label" placeholder="e.g. FR Regular Batch" />
          </div>
          <div>
            <label>Course here *</label>
            <select name="course_id" required defaultValue="">
              <option value="" disabled>choose…</option>
              {(courses ?? []).map((c) => <option key={c.id as string} value={c.id as string}>{c.title as string}</option>)}
            </select>
          </div>
          <div>
            <label>Subject (empty = whole course)</label>
            <select name="subject_id" defaultValue="">
              <option value="">Whole course</option>
              {(subjects ?? []).map((s) => (
                <option key={s.id as string} value={s.id as string}>
                  {courseTitle.get(s.course_id as string) ?? ""} — {s.title as string}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Tier</label>
            <select name="tier" defaultValue="gold">
              <option value="gold">Gold</option><option value="silver">Silver</option><option value="bronze">Bronze</option>
            </select>
          </div>
          <div>
            <label>Months</label>
            <input name="months" type="number" min={1} max={36} defaultValue={12} />
          </div>
          <SubmitButton className="btn" savedLabel="✓ Saved">Save mapping</SubmitButton>
        </form>
      </div>

      {/* Order log */}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong>📜 Orders over the bridge</strong>
          {unmapped > 0 && (
            <form action={retryUnmapped}>
              <SubmitButton className="btn small" savedLabel="✓ Retried">↻ Retry {unmapped} unmapped order(s)</SubmitButton>
            </form>
          )}
        </div>
        {(orders ?? []).length === 0 ? (
          <p className="muted" style={{ margin: "10px 0 0", fontSize: ".86rem" }}>
            Nothing yet. Once the webhook is set up on Aldine, every order shows here the moment it happens.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem", marginTop: 10 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: "4px 8px" }}>When</th>
                <th style={{ padding: "4px 8px" }}>Order</th>
                <th style={{ padding: "4px 8px" }}>Buyer</th>
                <th style={{ padding: "4px 8px" }}>Product</th>
                <th style={{ padding: "4px 8px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id as string} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(o.created_at as string)}</td>
                  <td style={{ padding: "6px 8px" }}>#{o.order_ref as string}</td>
                  <td style={{ padding: "6px 8px" }}>{(o.name as string) || ""}<br /><span className="muted">{o.email as string}</span></td>
                  <td style={{ padding: "6px 8px" }}>#{o.product_key as string}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {STATUS[o.status as string] ?? (o.status as string)}
                    {o.detail ? <span className="muted"> — {o.detail as string}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
