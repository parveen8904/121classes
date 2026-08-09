import Link from "next/link";
import AdminHero from "./_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { currentStaff, areaForPath } from "@/lib/adminAccess";
import { ADMIN_GROUPS } from "@/lib/adminNav";
import { getBunnyBilling } from "@/lib/bunny";

export const dynamic = "force-dynamic";
const INR = 85;

async function loadStats() {
  const svc = createServiceClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const head = { count: "exact" as const, head: true };
  const [students, openings, doubts, questions, ai, storage, bunny] = await Promise.all([
    svc.from("profiles").select("id", head).eq("role", "student"),
    svc.from("job_listings").select("id", head).eq("status", "new"),
    svc.from("doubts").select("id", head).eq("status", "open"),
    svc.from("page_questions").select("id", head).eq("status", "open"),
    // Aggregated in the DATABASE. Summing the raw rows here was silently cut
    // off by the 1,000-row cap, so the figure stopped moving four days into
    // the month and read barely half of what was really being spent.
    svc.rpc("ai_spend_since", { period_start: monthStart }),
    svc.rpc("storage_usage"),
    getBunnyBilling(),
  ]);
  const aiMonth = (ai.data ?? []).reduce((s: number, r: { cost_usd: number | string }) => s + (Number(r.cost_usd) || 0), 0);
  const stRow = Array.isArray(storage.data) ? storage.data[0] : storage.data;
  return {
    students: students.count ?? 0,
    openings: openings.count ?? 0,
    doubts: doubts.count ?? 0,
    questions: questions.count ?? 0,
    aiMonth,
    storageMb: stRow ? (Number(stRow.bytes) || 0) / (1024 * 1024) : 0,
    bunnyMonth: bunny ? bunny.thisMonth : null,
  };
}

export default async function AdminHome() {
  // Operators/faculty see only their granted areas (stats + tiles); admin sees all.
  const staff = await currentStaff();
  const isSuper = staff?.role === "admin";
  const canPath = (href?: string) => {
    if (isSuper || !href) return isSuper;
    const area = areaForPath(href);
    return area !== null && (staff?.permissions ?? []).includes(area);
  };
  const s = await loadStats();
  const inr = (usd: number) => `₹${Math.round(usd * INR)}`;
  const cards = [
    { label: "Students", value: String(s.students), href: "/admin/users" },
    { label: "Openings to review", value: String(s.openings), href: "/admin/placement", alert: s.openings > 0 },
    // One tile, one number, one destination. It used to be two — "open doubts"
    // from one table and "open questions" from another — which read as two
    // different problems and led to the same place.
    { label: "Doubts waiting", value: String(s.doubts + s.questions), href: "/admin/doubt-log", alert: s.doubts + s.questions > 0 },
    { label: "AI cost (this month)", value: inr(s.aiMonth), href: "/admin/costs" },
    ...(s.bunnyMonth !== null ? [{ label: "Bunny (this month)", value: inr(s.bunnyMonth), href: "/admin/costs" }] : []),
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
          <Link key={c.label} href={c.href} style={{ display: "block", textDecoration: "none" }}>
            <div style={{ background: "var(--bg-soft)", borderRadius: 10, padding: "14px 16px", border: c.alert ? "1px solid #f59e0b" : "1px solid transparent" }}>
              <div className="muted" style={{ fontSize: ".78rem" }}>{c.label}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: 2 }}>{c.value}</div>
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
