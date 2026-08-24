import Link from "next/link";
import AdminHero from "./_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { currentStaff, pathAllowed } from "@/lib/adminAccess";
import { ADMIN_GROUPS } from "@/lib/adminNav";
import { monthCostUsd } from "@/lib/monthCost";
import { displayUsdRate } from "@/lib/forexRates";

export const dynamic = "force-dynamic";
// The dollar rate is READ, not typed — see displayUsdRate(). A constant here
// understated every dollar cost by about twelve per cent against the rate the
// accounts desk actually works to.

async function loadStats() {
  const svc = createServiceClient();
  const head = { count: "exact" as const, head: true };
  const [students, openings, doubtSummary, storage, money, cost, usd] = await Promise.all([
    svc.from("profiles").select("id", head).eq("role", "student"),
    svc.from("job_listings").select("id", head).eq("status", "new"),
    // ONE DEFINITION OF "WAITING", AND IT LIVES IN ONE PLACE.
    //
    // This counted every row marked open, which is not the same thing: a doubt
    // can be open AND already answered — a distress reply stays open until a
    // person has spoken to them, and login-help settles itself. So the tile
    // said 8 while the report it links to listed 6, and the difference looked
    // like something had gone missing on the way.
    //
    // Both now ask the same function. There is nowhere left for them to
    // disagree.
    svc.rpc("doubt_report_summary", { p_days: 30 }),
    svc.rpc("storage_usage"),
    // THE MONEY, AGGREGATED IN THE DATABASE. One call, one definition of
    // "paid", all three tables — see admin_dashboard_money(). Summing rows in
    // here would be cut off at PostgREST's 1,000-row cap and under-report,
    // which is how the AI-spend tile once showed half the real figure.
    svc.rpc("admin_dashboard_money"),
    // The SAME figure the costs page shows — see lib/monthCost.ts. Two screens
    // computing one month's cost separately is how they come to disagree.
    monthCostUsd().catch(() => null),
    displayUsdRate(),
  ]);
  const m = (Array.isArray(money.data) ? money.data[0] : money.data) as
    { revenue_all: number; revenue_month: number; revenue_today: number;
      users_today: number; subscriptions_today: number } | null;
  const stRow = Array.isArray(storage.data) ? storage.data[0] : storage.data;
  return {
    students: students.count ?? 0,
    openings: openings.count ?? 0,
    waiting: Number((doubtSummary.data as { waiting?: number } | null)?.waiting ?? 0),
    storageMb: stRow ? (Number(stRow.bytes) || 0) / (1024 * 1024) : 0,
    revenueAll: Number(m?.revenue_all ?? 0),
    revenueMonth: Number(m?.revenue_month ?? 0),
    revenueToday: Number(m?.revenue_today ?? 0),
    usersToday: Number(m?.users_today ?? 0),
    subsToday: Number(m?.subscriptions_today ?? 0),
    costMonthUsd: cost?.total ?? null,
    usdRate: usd.rate,
  };
}

export default async function AdminHome() {
  // Operators/faculty see only their granted areas (stats + tiles); admin sees all.
  const staff = await currentStaff();
  const isSuper = staff?.role === "admin";
  // Use pathAllowed, not areaForPath+includes. /admin/assets is shared by three
  // grants (assets, assets_accounts, assets_editor); areaForPath returns only
  // the FIRST ("assets"), so a person holding just "assets_editor" — Pradeep —
  // had the Assets tile hidden though the page itself let him in by URL.
  // pathAllowed checks EVERY grant the staff member holds.
  const canPath = (href?: string) => {
    if (isSuper || !href) return isSuper;
    return !!staff && pathAllowed(href, staff);
  };
  const s = await loadStats();
  const inr = (usdAmount: number) => `₹${Math.round(usdAmount * s.usdRate).toLocaleString("en-IN")}`;
  // The money first — it is the thing he opens this page to see. Rupee figures
  // are already rupees; inr() below converts DOLLAR costs and must not touch
  // them (that mistake would multiply revenue by 85).
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const cards = [
    { label: "Revenue today", value: rupees(s.revenueToday), href: "/admin/reports/sales" },
    { label: "Revenue this month", value: rupees(s.revenueMonth), href: "/admin/reports/sales" },
    { label: "Revenue in total", value: rupees(s.revenueAll), href: "/admin/reports/sales" },
    { label: "Subscriptions sold today", value: String(s.subsToday), href: "/admin/orders" },
    { label: "Users added today", value: String(s.usersToday), href: "/admin/users" },
    { label: "Students", value: String(s.students), href: "/admin/users" },
    { label: "Openings to review", value: String(s.openings), href: "/admin/placement", alert: s.openings > 0 },
    // One tile, one number, one destination. It used to be two — "open doubts"
    // from one table and "open questions" from another — which read as two
    // different problems and led to the same place.
    // One number from one table, now that every channel writes to it.
    { label: "Doubts waiting", value: String(s.waiting), href: "/admin/doubt-log", alert: s.waiting > 0 },
    // Everything the month costs, AI included — the one number to set the
    // revenue tiles against. inr() converts dollars: every provider bills in
    // USD, so the total is summed in dollars and converted once, here.
    ...(s.costMonthUsd !== null ? [{
      label: "Total cost (this month)",
      value: inr(s.costMonthUsd),
      href: "/admin/costs",
    }] : []),
    { label: "Storage used", value: `${s.storageMb.toFixed(1)} MB`, href: "/admin/costs" },
  ];
  const visibleCards = isSuper ? cards : cards.filter((c) => canPath(c.href));
  // Groups render only the tiles this staff member may open; empty groups hide.
  const visibleGroups = ADMIN_GROUPS
    .map((g) => ({ ...g, panels: isSuper ? g.panels : g.panels.filter((p) => canPath(p.href)) }))
    .filter((g) => g.panels.length > 0)
    // The reports each get their own entry in the header menu, but on the
    // dashboard they collapse to ONE tile. Listing ten more tiles here would
    // have made the wall of tiles worse, which is the thing being fixed.
    .map((g) =>
      g.id === "reports"
        ? {
            ...g,
            panels: [{
              icon: "📊",
              title: "Reports",
              desc: `Everything worth reading, in one place — ${g.panels.map((p) => p.title.replace(/ report$/i, "").toLowerCase()).slice(0, 5).join(", ")} and more. Nothing here changes anything.`,
              href: "/admin/reports",
            }],
          }
        : g,
    );
  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🛠️ Admin dashboard"
        title="Admin dashboard"
        subtitle="Your control centre — key numbers at a glance, then everything to manage below. 🚀"
      />
      <p style={{ marginTop: 10 }}>
        <Link className="btn small secondary" href="/admin/guide">📖 New here? How to use this panel — step-by-step guide</Link>
      </p>

      {/* At-a-glance stats */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 18, marginBottom: 26 }}>
        {visibleCards.map((c) => (
          <Link key={c.label} href={c.href} style={{ display: "block", textDecoration: "none", height: "100%" }}>
            <div style={{
              background: "var(--bg-soft)", borderRadius: 10, padding: "14px 16px",
              border: c.alert ? "1px solid #f59e0b" : "1px solid transparent",
              // Fill the grid cell and lay out top-to-bottom, so every tile in a
              // row is exactly as tall as the row — no ragged edges.
              height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box",
            }}>
              {/* Two lines reserved for the label: "Subscriptions sold today"
                  wraps where "Students" does not, and without this the two
                  tiles sit at different heights. */}
              <div className="muted" style={{ fontSize: ".78rem", lineHeight: 1.35, minHeight: "2.1em" }}>{c.label}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
            </div>
          </Link>
        ))}
      </div>

      {visibleGroups.map((g) => (
        <div key={g.id} id={g.id} style={{ scrollMarginTop: 90 }}>
          <h2 className="admin-section-title" style={{ marginTop: 28 }}>{g.icon} {g.title}</h2>
          <p className="muted" style={{ margin: "4px 0 12px", fontSize: ".85rem" }}>{g.tagline}</p>
          <div className="admin-cards">
            {g.panels.map((p) => (
              <Link key={p.href} href={p.href} style={{ display: "block" }}>
                <div className="admin-tile">
                  <div className="tile-ic">{p.icon}</div>
                  <h3>{p.title}</h3>
                  <p>{p.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
