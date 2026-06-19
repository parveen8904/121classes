import Link from "next/link";
import AdminHero from "./_components/AdminHero";

// The layout already guards admin access, so this is just the hub.
const PANELS: { icon: string; title: string; desc: string; href?: string; phase?: string }[] = [
  {
    icon: "📘",
    title: "Courses & content",
    desc: "Create courses → subjects → topics → sections, including homework & discussion.",
    href: "/admin/courses",
  },
  {
    icon: "👥",
    title: "Users",
    desc: "View, edit & manage every account — roles, attempts, contact details.",
    href: "/admin/users",
  },
  {
    icon: "👩‍🏫",
    title: "Faculty",
    desc: "Add faculty (name, photo, bio) and assign them to subjects.",
    href: "/admin/faculty",
  },
  {
    icon: "📣",
    title: "Announcements",
    desc: "Amendments, what's new, student corner, industry & macro updates.",
    href: "/admin/announcements",
  },
  {
    icon: "🎟️",
    title: "Enrolment",
    desc: "Grant course access (single or bulk) for any tier/duration; revoke & extend.",
    href: "/admin/enrolment",
  },
  {
    icon: "💳",
    title: "Plans & pricing",
    desc: "Bronze/Silver/Gold per-month prices; duration discounts; web vs app.",
    href: "/admin/plans",
  },
  {
    icon: "📦",
    title: "Books",
    desc: "Manage the book catalogue, prices and stock for the store.",
    href: "/admin/books",
  },
  {
    icon: "🚚",
    title: "Book orders",
    desc: "Fulfil paid orders — view delivery details and mark dispatched.",
    href: "/admin/orders",
  },
  {
    icon: "📡",
    title: "Live classes",
    desc: "Schedule live sessions (Zoom/Meet) and attach recordings after.",
    href: "/admin/live",
  },
  {
    icon: "🏆",
    title: "Results",
    desc: "Showcase rank-holders & toppers — the #1 trust signal for CA students.",
    href: "/admin/results",
  },
  {
    icon: "🏷️",
    title: "Coupons",
    desc: "Run % or flat-amount discount codes applied at checkout.",
    href: "/admin/coupons",
  },
  {
    icon: "🎁",
    title: "Combos",
    desc: "Bundle several subjects at one discounted price.",
    href: "/admin/combos",
  },
  {
    icon: "📊",
    title: "Reports",
    desc: "Revenue, active plans, book sales and dispatch snapshot.",
    href: "/admin/reports",
  },
  {
    icon: "🖼️",
    title: "Site images",
    desc: "Upload your founder photo and homepage banner from Canva.",
    href: "/admin/site",
  },
  {
    icon: "🔐",
    title: "Downloadable classes",
    desc: "Register encrypted classes for the Mac/Windows desktop app.",
    href: "/admin/protected",
  },
  {
    icon: "📣",
    title: "Notify students",
    desc: "Broadcast updates by Telegram, email & WhatsApp.",
    href: "/admin/notifications",
  },
  {
    icon: "💰",
    title: "Costs & usage",
    desc: "AI, Bunny, Cloudflare & Supabase costs in one place.",
    href: "/admin/costs",
  },
  {
    icon: "🤖",
    title: "AI usage detail",
    desc: "Anthropic token spend by feature & model; cap & alert.",
    href: "/admin/ai-usage",
  },
  {
    icon: "🎓",
    title: "Student placement",
    desc: "Auto-pulled CA openings — categorise & approve to publish.",
    href: "/admin/placement",
  },
];

export default function AdminHome() {
  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🛠️ Admin"
        title="Admin panel"
        subtitle="Manage your catalogue, faculty, enrolments and announcements — all in one place. 🚀"
      />

      <div className="admin-cards">
        {PANELS.map((p) => {
          const inner = (
            <div className={`admin-tile${p.href ? "" : " soon"}`}>
              <div className="tile-ic">{p.icon}</div>
              <h3>
                {p.title}
                {p.phase && <span className="badge">{p.phase}</span>}
              </h3>
              <p>{p.desc}</p>
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
