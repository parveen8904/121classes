import Link from "next/link";

// The layout already guards admin access, so this is just the hub.
const PANELS: { title: string; desc: string; href?: string; phase?: string }[] = [
  {
    title: "Courses & content",
    desc: "Create courses → subjects → topics → sections, including custom sections.",
    href: "/admin/courses",
  },
  {
    title: "Faculty",
    desc: "Add faculty (name, photo, bio) and assign them to subjects.",
    href: "/admin/faculty",
  },
  {
    title: "Announcements",
    desc: "Amendments, what's new, student corner, industry & macro updates.",
    href: "/admin/announcements",
  },
  {
    title: "Enrolment",
    desc: "Grant course access (single or bulk) for any tier/duration; revoke & extend.",
    href: "/admin/enrolment",
  },
  {
    title: "Plans & pricing",
    desc: "Bronze/Silver/Gold per-month prices; duration discounts; web vs app.",
    href: "/admin/plans",
  },
  { title: "Live classes", desc: "Schedule Zoom webinars.", phase: "Phase 6" },
  { title: "Books & warehouse", desc: "Catalogue + end-of-day dispatch email.", phase: "Phase 5" },
  { title: "Reporting", desc: "Finance, student & warehouse emails.", phase: "Phase 8" },
];

export default function AdminHome() {
  return (
    <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <span className="badge">Admin</span>
      <h1 style={{ margin: "14px 0 6px" }}>Admin panel</h1>
      <p className="muted">Manage the catalogue, faculty and announcements.</p>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          marginTop: 28,
        }}
      >
        {PANELS.map((p) => {
          const inner = (
            <div className="card" style={{ height: "100%", opacity: p.href ? 1 : 0.6 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {p.title}
                {p.phase && <span className="badge">{p.phase}</span>}
              </h3>
              <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
                {p.desc}
              </p>
            </div>
          );
          return p.href ? (
            <Link key={p.title} href={p.href} style={{ display: "block" }}>
              {inner}
            </Link>
          ) : (
            <div key={p.title}>{inner}</div>
          );
        })}
      </div>
    </section>
  );
}
