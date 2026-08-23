import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";
import { formatINR } from "@/lib/pricing";
import { matchesState } from "@/lib/accountsExport";
import AdminHero from "../../_components/AdminHero";

// READ IT FRESH, EVERY TIME.
//
// Every other report on this desk declares this and this one did not, so Next
// served it from its cache: today's sales were missing from a page whose whole
// job is to show today's sales. A stale sales figure is worse than no page.
export const dynamic = "force-dynamic";

const inr = (n: number) => "₹" + (Math.round(n) || 0).toLocaleString("en-IN");

function fmt(s: string): string {
  return formatDate(s);
}

type SubRow = { status: string; ends_at: string | null; plans: { tier: string } | null };
type MoneyRow = { amount_inr: number | null; status: string; created_at: string };
type BookOrderRow = {
  amount_inr: number;
  status: string;
  created_at: string;
  items: { book_id?: string; qty?: number }[] | null;
};

/**
 * Every subscription, not the first thousand.
 *
 * PostgREST answers a plain select with at most 1,000 rows and says nothing
 * about the rest. There are more than 1,500 active subscriptions, so this
 * report quietly counted about two thirds of them — the tier breakdown was
 * short by hundreds and looked perfectly plausible, which is what made it
 * dangerous. The same silence once hid two thirds of the AI bill.
 */
type Client = ReturnType<typeof createServiceClient> | Awaited<ReturnType<typeof createClient>>;

async function readAll<T>(supabase: Client, table: string, columns: string): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) break;
    const page = (data ?? []) as unknown as T[];
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all;
}

export default async function ReportsPage() {
  const supabase = createClient();
  // THE MONEY IS READ WITH THE SERVICE KEY, THE REST WITH HIS OWN SESSION.
  //
  // Sponsorships came back as ₹0 on the first attempt: gift_orders is closed to
  // the browser key by row-level security, and a policy that returns no rows
  // returns no error either — the report would simply have gone on saying zero.
  // The gift table lower down this page already read past it this way.
  const svc = createServiceClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [subOrders, bookOrders, giftOrders, subs, { count: students }, { data: books }] =
    await Promise.all([
      readAll<MoneyRow>(svc, "orders", "amount_inr, status, created_at"),
      readAll<BookOrderRow>(svc, "book_orders", "amount_inr, status, created_at, items"),
      readAll<MoneyRow>(svc, "gift_orders", "amount_inr, status, created_at"),
      readAll<SubRow>(supabase, "subscriptions", "status, ends_at, plans(tier)"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
      supabase.from("books").select("id, title"),
    ]);

  // ONE DEFINITION OF A SALE, SHARED WITH THE ACCOUNTS DESK.
  //
  // This page said ₹98,000 while Accounts & Zoho said ₹1,33,000 for the same
  // day, and both were reading the same database. Two reasons, both here:
  //
  //   · SPONSORSHIPS WERE NOT COUNTED AT ALL. Five supporters had bought
  //     ₹35,093 of subscriptions for students. They sat in gift_orders, which
  //     this report listed in a table further down but never added to revenue.
  //   · A BOOK ORDER COUNTED UNLESS IT WAS CANCELLED — so an abandoned
  //     checkout that was never paid would have counted as money.
  //
  // Both now use matchesState(), the same function the accounts export uses, so
  // the two pages cannot drift apart again.
  const paid = <T extends { status: string }>(rows: T[]) => rows.filter((r) => matchesState(r.status, "paid"));
  const sum = (rows: { amount_inr?: number | null }[]) => rows.reduce((t, r) => t + Number(r.amount_inr ?? 0), 0);
  const thisMonth = <T extends { created_at: string }>(rows: T[]) => rows.filter((r) => r.created_at >= monthStart);

  const paidSubOrders = paid(subOrders);
  const paidBookOrders = paid(bookOrders);
  const paidGiftOrders = paid(giftOrders);

  const subRevenue = sum(paidSubOrders);
  const bookRevenue = sum(paidBookOrders);
  const giftRevenue = sum(paidGiftOrders);

  const totalRevenue = subRevenue + bookRevenue + giftRevenue;
  const monthRevenue = sum(thisMonth(paidSubOrders)) + sum(thisMonth(paidBookOrders)) + sum(thisMonth(paidGiftOrders));

  const subsRows = subs;
  const activeSubs = subsRows.filter(
    (s) => s.status === "active" && (!s.ends_at || new Date(s.ends_at) > now),
  );
  const byTier: Record<string, number> = { bronze: 0, silver: 0, gold: 0 };
  for (const s of activeSubs) {
    const t = s.plans?.tier;
    if (t && t in byTier) byTier[t] += 1;
  }

  // Top books by quantity sold.
  const titleById = new Map((books ?? []).map((b) => [b.id, b.title]));
  const qtyByBook = new Map<string, number>();
  for (const o of paidBookOrders) {
    for (const it of o.items ?? []) {
      if (it.book_id) qtyByBook.set(it.book_id, (qtyByBook.get(it.book_id) ?? 0) + (it.qty ?? 0));
    }
  }
  const topBooks = [...qtyByBook.entries()]
    .map(([id, qty]) => ({ title: titleById.get(id) ?? "Book", qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const toDispatch = paidBookOrders.filter((o) => o.status === "paid").length;

  const kpis: { icon: string; label: string; value: string; href?: string }[] = [
    { icon: "💰", label: "Total revenue", value: formatINR(totalRevenue), href: "/admin/orders" },
    { icon: "📅", label: "This month", value: formatINR(monthRevenue), href: "/admin/orders" },
    { icon: "🎓", label: "Active subscriptions", value: String(activeSubs.length), href: "/admin/reports/subscribers" },
    { icon: "👥", label: "Students", value: String(students ?? 0), href: "/admin/users" },
    { icon: "📦", label: "Book orders", value: String(paidBookOrders.length), href: "/admin/orders" },
    { icon: "🚚", label: "Awaiting dispatch", value: String(toDispatch), href: "/admin/orders" },
  ];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="💰 Sales report"
        title="Revenue, enrolments and book sales"
        subtitle="A live snapshot of the money — what came in, from which plan, and what is still to be dispatched. 📈"
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <div className="admin-cards" style={{ marginTop: 24, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        {kpis.map((k) => (
          <a className="admin-tile" key={k.label} href={k.href} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="tile-ic">{k.icon}</div>
            <h3 style={{ fontSize: "1.5rem" }}>{k.value}</h3>
            <p>{k.label}</p>
          </a>
        ))}
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>💵 Revenue split</h3>
          <p style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="muted">📘 Subscriptions</span> <strong>{formatINR(subRevenue)}</strong>
          </p>
          <p style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span className="muted">🎁 Sponsorships</span> <strong>{formatINR(giftRevenue)}</strong>
          </p>
          <p style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span className="muted">📦 Books</span> <strong>{formatINR(bookRevenue)}</strong>
          </p>
          <p style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <span>Total</span> <strong>{formatINR(totalRevenue)}</strong>
          </p>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 4 }}>🎓 Active plans by tier</h3>
          <p className="muted" style={{ fontSize: ".78rem", margin: "0 0 10px" }}>Click any tier to see the full subscriber list with dates, amounts &amp; contact details.</p>
          {([["bronze", "🥉 Bronze", byTier.bronze], ["silver", "🥈 Silver", byTier.silver], ["gold", "🥇 Gold", byTier.gold]] as const).map(([tier, label, count]) => (
            <a
              key={tier}
              href={`/admin/reports/subscribers?tier=${tier}`}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", marginTop: 6, borderRadius: 10,
                border: "1px solid var(--border)", textDecoration: "none", color: "inherit",
              }}
            >
              <span>{label}</span>
              <span style={{ fontWeight: 800 }}>{count} <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".82rem" }}>See list →</span></span>
            </a>
          ))}
        </div>
      </div>

      <h2 className="admin-section-title">🏆 Top-selling books</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {topBooks.length > 0 ? (
          topBooks.map((b) => (
            <div className="list-row" key={b.title}>
              <span className="row-title">📚 {b.title}</span>
              <strong>{b.qty} sold</strong>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No book sales yet.</p>
          </div>
        )}
      </div>

      {/* Gift subscriptions — transactions, GST breakup & invoices */}
      {await (async () => {
        const svc = createServiceClient();
        const { data: gifts } = await svc
          .from("gift_orders")
          .select("id, created_at, paid_at, status, recipient_name, recipient_email, billing_name, billing_state, amount_inr, taxable_value, cgst, sgst, igst, invoice_no, invoice_url, tier, months")
          .order("created_at", { ascending: false })
          .limit(200);
        const paid = (gifts ?? []).filter((g) => g.status === "provisioned" || g.status === "paid");
        const total = paid.reduce((s, g) => s + Number(g.amount_inr || 0), 0);
        const tax = paid.reduce((s, g) => s + Number(g.cgst || 0) + Number(g.sgst || 0) + Number(g.igst || 0), 0);
        const th = { padding: "6px 8px", textAlign: "left" as const, color: "var(--muted)" };
        const td = { padding: "6px 8px" };
        return (
          <div style={{ marginTop: 28 }}>
            <h2 className="admin-section-title">🎁 Gift subscriptions &amp; invoices</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0 12px" }}>
              <span className="card" style={{ padding: "6px 12px" }}><strong>{paid.length}</strong> gifts · {inr(total)} collected · GST {inr(tax)}</span>
            </div>
            {paid.length === 0 ? (
              <div className="card"><p className="muted" style={{ margin: 0 }}>No gift purchases yet.</p></div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
                  <thead><tr>
                    <th style={th}>Date</th><th style={th}>Invoice</th><th style={th}>Gifter</th><th style={th}>Recipient</th>
                    <th style={th}>Plan</th><th style={th}>State</th><th style={th}>Taxable</th><th style={th}>CGST</th><th style={th}>SGST</th><th style={th}>IGST</th><th style={th}>Total</th><th style={th}>Invoice</th>
                  </tr></thead>
                  <tbody>
                    {paid.map((g) => (
                      <tr key={g.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={td}>{fmt(g.paid_at || g.created_at)}</td>
                        <td style={td}>{g.invoice_no || "—"}</td>
                        <td style={td}>{g.billing_name || "—"}</td>
                        <td style={td}>{g.recipient_name}<br /><span className="muted">{g.recipient_email}</span></td>
                        <td style={td}>{g.tier} · {g.months}m</td>
                        <td style={td}>{g.billing_state}</td>
                        <td style={td}>{inr(Number(g.taxable_value || 0))}</td>
                        <td style={td}>{inr(Number(g.cgst || 0))}</td>
                        <td style={td}>{inr(Number(g.sgst || 0))}</td>
                        <td style={td}>{inr(Number(g.igst || 0))}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{inr(Number(g.amount_inr || 0))}</td>
                        <td style={td}>{g.invoice_url ? <a className="grad" href={viaProxy(g.invoice_url)} target="_blank" rel="noopener noreferrer">PDF ↓</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      <p className="muted" style={{ fontSize: ".82rem", marginTop: 24 }}>
        As of {fmt(now.toISOString())} · revenue counts every paid online order — a student&apos;s own
        subscription, a supporter&apos;s sponsorship and a book — on the same definition of &ldquo;paid&rdquo;
        the accounts desk uses, so this total and the one on{" "}
        <a href="/admin/accounts">Accounts &amp; Zoho</a> are the same figure. Abandoned checkouts and
        admin-granted free enrolments are not revenue.
      </p>
    </section>
  );
}
