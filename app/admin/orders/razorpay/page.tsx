import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/pricing";
import AdminHero from "../../_components/AdminHero";
import { listRazorpayPayments, type RazorpayPayment } from "@/lib/razorpay";

export const dynamic = "force-dynamic";
export const metadata = { title: "Razorpay data — Admin" };

const DAY_OPTIONS = [
  { v: "7", label: "Last 7 days" },
  { v: "30", label: "Last 30 days" },
  { v: "90", label: "Last 3 months" },
  { v: "180", label: "Last 6 months" },
  { v: "365", label: "Last 1 year" },
];
const STATUS_OPTIONS = [
  { v: "all", label: "Everything" },
  { v: "captured", label: "Received (captured)" },
  { v: "failed", label: "Failed attempts" },
  { v: "refunded", label: "Refunded" },
  { v: "authorized", label: "Authorized (not captured)" },
];
const METHOD_OPTIONS = [
  { v: "all", label: "All methods" },
  { v: "upi", label: "UPI" },
  { v: "card", label: "Card" },
  { v: "netbanking", label: "Netbanking" },
  { v: "wallet", label: "Wallet" },
];

export default async function RazorpayDataPage(props: {
  searchParams: Promise<{ days?: string; status?: string; method?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  if (prof?.role !== "admin") {
    return <section className="container" style={{ paddingTop: 40 }}><p>Admins only.</p></section>;
  }

  const days = Math.min(365, Math.max(1, parseInt(sp.days ?? "90", 10) || 90));
  const status = sp.status && sp.status !== "all" ? sp.status : "";
  const method = sp.method && sp.method !== "all" ? sp.method : "";

  let payments: RazorpayPayment[] = [];
  let error = false;
  try { payments = await listRazorpayPayments(days, 500); } catch { error = true; }
  if (status) payments = payments.filter((p) => p.status === status || (status === "refunded" && p.status === "refunded"));
  if (method) payments = payments.filter((p) => p.method === method);

  const receivedTotal = payments.filter((p) => p.status === "captured").reduce((s, p) => s + (p.amount || 0), 0) / 100;
  const exportQs = `?days=${days}&status=${sp.status ?? "all"}&method=${sp.method ?? "all"}`;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📈 Razorpay"
        title="Razorpay account data"
        subtitle="Everything collected on the Razorpay account — for cross-checking only. ⚠️"
        back={{ href: "/admin/orders", label: "Sales & orders" }}
      />

      <div className="notice" style={{ marginTop: 16 }}>
        ⚠️ This Razorpay key is used in more than one place, so the list below can include collections that are
        <strong> not</strong> this website&apos;s sales. Your sales register is
        {" "}<a className="grad" href="/admin/orders">Website payments</a> — use this page only to verify against Razorpay.
      </div>

      {/* What to pull */}
      <div className="card" style={{ marginTop: 14 }}>
        <strong>🔧 What do you want to pull?</strong>
        <form style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label>Period</label>
            <select name="days" defaultValue={String(days)}>
              {DAY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label>Status</label>
            <select name="status" defaultValue={sp.status ?? "all"}>
              {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label>Payment method</label>
            <select name="method" defaultValue={sp.method ?? "all"}>
              {METHOD_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <button className="btn small" type="submit">Pull data</button>
          <a className="btn small secondary" href={`/admin/orders/razorpay/export${exportQs}`}>⬇️ Download Excel (CSV)</a>
        </form>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 22 }}>
        {payments.length} payment{payments.length === 1 ? "" : "s"} · {formatINR(receivedTotal)} received
      </h2>
      <div className="card" style={{ marginTop: 10 }}>
        {error ? (
          <p className="muted" style={{ margin: 0 }}>Couldn&apos;t reach Razorpay right now — refresh in a minute, or check the keys on Integrations.</p>
        ) : payments.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing matches these options.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "6px 8px" }}>Date</th><th style={{ padding: "6px 8px" }}>Payer</th>
                  <th style={{ padding: "6px 8px" }}>Method</th><th style={{ padding: "6px 8px" }}>Description</th>
                  <th style={{ padding: "6px 8px" }}>Amount</th><th style={{ padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {new Date(p.created_at * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{p.email || p.contact || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{p.method}</td>
                    <td style={{ padding: "6px 8px" }}>{p.description || p.notes?.kind || "—"}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{formatINR((p.amount || 0) / 100)}</td>
                    <td style={{ padding: "6px 8px" }}>{p.status === "captured" ? "✅ received" : p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
