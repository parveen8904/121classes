import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { formatDate } from "@/lib/dates";
import { accountRows, ACCOUNT_STATES } from "@/lib/accountsExport";
import { viaProxy } from "@/lib/fileProxy";
import SubmitButton from "@/app/components/SubmitButton";
import { approveDayForZoho, approveSelectedForZoho, approveForZoho, holdForZoho } from "../orders/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const metadata = { title: "Accounts & Zoho — Admin" };

// THE ACCOUNTS DEPARTMENT'S OWN SCREEN.
//
// The sales page answers "what did we sell". This answers a different question
// and belongs to different people: does what Razorpay took match what Zoho
// Books has, and where does it not.
//
// It is deliberately a separate page rather than another tab on Sales. The
// existing "Download Excel — everything" works and is relied on; the surest way
// to break a working report is to keep adding to it.

// Compact + wrapping so the eleven-column sale table FITS the page instead of
// running off the side. Headers may wrap (no nowrap), long values (emails,
// Razorpay ids) break rather than push the table wide, and the overflow wrapper
// stays as a safety net on very narrow phones.
const th: React.CSSProperties = { padding: "6px 7px", textAlign: "left", color: "var(--muted)", fontWeight: 700, fontSize: ".74rem" };
const td: React.CSSProperties = { padding: "6px 7px", verticalAlign: "top", fontSize: ".8rem", wordBreak: "break-word" };
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export default async function AccountsPage(props: {
  searchParams: Promise<{ from?: string; to?: string; state?: string; zoho?: string; q?: string }>;
}) {
  await assertArea("store");
  const sp = await props.searchParams;
  const filter = { from: sp.from, to: sp.to, state: sp.state, zoho: sp.zoho, q: sp.q };
  const rows = await accountRows(filter);

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v) query.set(k, v);
  const qs = query.toString();

  const paid = rows.filter((r) => (ACCOUNT_STATES.paid ?? []).includes(r.status));
  const took = paid.reduce((s, r) => s + r.total, 0);
  const noInvoice = paid.filter((r) => !r.invoiceNo);
  const notInZoho = paid.filter((r) => r.zohoStatus !== "posted" && r.table !== "gift_orders");

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 1200 }}>
      <AdminHero
        badge="🧮 Accounts & Zoho"
        title="What Razorpay took, and what Zoho Books has"
        subtitle="A separate view for the accounts department: every sale with its invoice, its receipt, its Razorpay reference and where it stands with Zoho — so a mismatch can be found rather than discovered at the year end."
        back={{ href: "/admin/orders", label: "Sales & orders" }}
      />

      {/* Said out loud, because it is the one thing that must not change. */}
      <div className="notice" style={{ marginTop: 14, fontSize: ".85rem", lineHeight: 1.7 }}>
        This is <strong>separate</strong> from the sales export. <strong>Download Excel — everything</strong> on the
        Sales &amp; orders page is untouched: same button, same columns, same file. Nothing here writes to it and
        nothing here changes it.
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <form className="card" style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={{ fontSize: ".75rem" }}>🔎 Search — order no, invoice no, email, phone or Razorpay ID</label>
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="e.g. 20014, name@email.com, 9810012674, pay_Nx…"
            style={{ marginBottom: 0, width: "100%" }}
          />
        </div>
        <div>
          <label style={{ fontSize: ".75rem" }}>From (IST)</label>
          <input type="date" name="from" defaultValue={sp.from ?? ""} style={{ marginBottom: 0 }} />
        </div>
        <div>
          <label style={{ fontSize: ".75rem" }}>To</label>
          <input type="date" name="to" defaultValue={sp.to ?? ""} style={{ marginBottom: 0 }} />
        </div>
        <div>
          <label style={{ fontSize: ".75rem" }}>State of the sale</label>
          <select name="state" defaultValue={sp.state ?? ""} style={{ marginBottom: 0 }}>
            <option value="">Any</option>
            <option value="paid">Paid</option>
            <option value="created">Created (not paid)</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded / cancelled</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: ".75rem" }}>Zoho</label>
          <select name="zoho" defaultValue={sp.zoho ?? ""} style={{ marginBottom: 0 }}>
            <option value="">Any</option>
            <option value="pending">Waiting for approval</option>
            <option value="approved">Approved, not pushed</option>
            <option value="posted">Pushed to Zoho</option>
            <option value="skipped">Skipped</option>
            <option value="none">No Zoho status</option>
          </select>
        </div>
        <button className="btn small" type="submit">Apply</button>
        {qs && <Link className="btn small secondary" href="/admin/accounts">Clear</Link>}
      </form>

      {/* ── What the filter selected ────────────────────────────────────── */}
      <div className="admin-cards" style={{ marginTop: 14, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="admin-tile"><div className="tile-ic">📄</div><h3 style={{ fontSize: "1.4rem" }}>{rows.length}</h3><p>rows selected</p></div>
        <div className="admin-tile"><div className="tile-ic">💰</div><h3 style={{ fontSize: "1.4rem" }}>{inr(took)}</h3><p>paid, {paid.length} sale(s)</p></div>
        <div className="admin-tile"><div className="tile-ic">🧾</div><h3 style={{ fontSize: "1.4rem" }}>{noInvoice.length}</h3><p>paid with NO invoice</p></div>
        <div className="admin-tile"><div className="tile-ic">📤</div><h3 style={{ fontSize: "1.4rem" }}>{notInZoho.length}</h3><p>paid, not yet in Zoho</p></div>
      </div>

      {/* ── THE ZOHO CONTROLS, WHERE THE ACCOUNTS OPERATOR ACTUALLY WORKS ──
          These lived on the Sales page. The person who sends sales to Zoho
          works on THIS page, so on the sales page they were furniture. Moved on
          the office's instruction, 19 Aug; the actions themselves are the same
          ones, imported — one approval path, two doors closed to one. */}
      <div className="card" style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <strong>🧾 Send a whole day to Zoho Books</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
            Approves every pending paid sale on that date; it posts to Zoho tonight automatically. Anything held on
            the Sales page stays excluded.
          </p>
        </div>
        <form action={approveDayForZoho} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
          <input type="date" name="day" defaultValue={new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)} required style={{ marginBottom: 0 }} />
          <SubmitButton className="btn small" savedLabel="✓ Approved">✅ Approve this date → Zoho</SubmitButton>
        </form>
      </div>

      <form id="zoho-bulk" action={approveSelectedForZoho} className="card" style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <strong>🧾 Push to Zoho Books</strong>
          <span className="muted" style={{ fontSize: ".78rem" }}>
            Tick the pending sales in the table below, then push — they post to Zoho tonight automatically.
          </span>
        </div>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <a className="btn small secondary" href="/admin/orders/razorpay">📈 Razorpay account data</a>
          <SubmitButton className="btn small" savedLabel="✓ Pushed">✅ Push selected → Zoho</SubmitButton>
        </span>
      </form>

      {/* ── The two files ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <a className="btn small" href={`/admin/accounts/export?what=invoices${qs ? `&${qs}` : ""}`}>⬇️ Export Invoice</a>
        <a className="btn small" href={`/admin/accounts/export?what=payments${qs ? `&${qs}` : ""}`}>⬇️ Export Payment</a>
        <span className="muted" style={{ fontSize: ".82rem", lineHeight: 1.6, flex: 1, minWidth: 260 }}>
          Both files honour the filters above, so what downloads is what is on this screen. An invoice is the
          document raised; a payment is money received against it — Zoho imports them separately and they cannot be
          one file.
        </span>
      </div>

      {/* ── The rows ────────────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 26 }}>Every selected sale</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Zoho ✓</th>
            <th style={th}>Date</th><th style={th}>Order</th><th style={th}>Invoice</th><th style={th}>Receipt</th>
            <th style={th}>Customer</th><th style={th}>What</th>
            <th style={{ ...th, textAlign: "right" }}>Amount</th>
            <th style={th}>State</th><th style={th}>Razorpay payment</th><th style={th}>Zoho</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td style={td} colSpan={11}><span className="muted">Nothing matches those filters.</span></td></tr>
            )}
            {rows.slice(0, 500).map((r) => (
              <tr key={`${r.table}-${r.id}`} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>
                  {r.zohoStatus === "pending" && r.table !== "gift_orders" ? (
                    <input type="checkbox" name="zoho_ids" value={`${r.table}:${r.id}`} form="zoho-bulk" title="Tick to include in the Zoho push" />
                  ) : null}
                </td>
                <td style={td}>{formatDate(r.date)}</td>
                <td style={td}>{r.orderNo || "—"}</td>
                <td style={td}>
                  {r.invoiceNo
                    ? (r.invoiceUrl
                        ? <a href={viaProxy(r.invoiceUrl)} target="_blank" rel="noopener noreferrer" className="grad" title="Open the invoice PDF">🧾 {r.invoiceNo} ↓</a>
                        : r.invoiceNo)
                    : <span style={{ color: "var(--bad)" }}>none</span>}
                </td>
                <td style={td}>{r.receiptNo || "—"}</td>
                <td style={td}>{r.customer || "—"}<br /><span className="muted" style={{ fontSize: ".78rem" }}>{r.email}</span></td>
                <td style={td}>{r.description}</td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{inr(r.total)}</td>
                <td style={td}>{r.status}</td>
                <td style={{ ...td, fontFamily: "ui-monospace,monospace", fontSize: ".76rem" }}>
                  {r.razorpayPaymentId || <span className="muted">—</span>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {/* Approve and Hold live HERE now — the office asked for them
                      beside the rest of the Zoho work, not on the sales register. */}
                  {r.zohoStatus === "posted" ? "✅ posted"
                    : r.zohoStatus === "approved" ? "⏳ tonight"
                    : r.zohoStatus === "skipped" ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        🚫 held
                        <form action={holdForZoho} style={{ margin: 0, display: "inline" }}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="table" value={r.table} />
                          <input type="hidden" name="to" value="pending" />
                          <SubmitButton className="btn small secondary" savedLabel="✓">Undo</SubmitButton>
                        </form>
                      </span>
                    )
                    : r.zohoStatus === "pending" && r.table !== "gift_orders" ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <form action={approveForZoho} style={{ margin: 0, display: "inline" }}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="table" value={r.table} />
                          <SubmitButton className="btn small secondary" savedLabel="✓">Approve</SubmitButton>
                        </form>
                        <form action={holdForZoho} style={{ margin: 0, display: "inline" }} title="Fishy? Hold it — excluded from day approval, never posts">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="table" value={r.table} />
                          <input type="hidden" name="to" value="skipped" />
                          <SubmitButton className="btn small secondary" savedLabel="✓">✋ Hold</SubmitButton>
                        </form>
                      </span>
                    )
                    : <span className="muted">{r.zohoStatus || "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && (
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
          Showing the first 500 of {rows.length} on screen. The downloads contain all of them.
        </p>
      )}
    </section>
  );
}
