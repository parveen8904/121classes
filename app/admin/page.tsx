import Link from "next/link";
import AdminHero from "./_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { currentStaff, areaForPath } from "@/lib/adminAccess";
import { getBunnyBilling } from "@/lib/bunny";

export const dynamic = "force-dynamic";
const INR = 85;

// The layout already guards admin access, so this is just the hub.
const PANELS: { icon: string; title: string; desc: string; href?: string; phase?: string }[] = [
  {
    icon: "🩺",
    title: "Server health",
    desc: "Live: how busy the server is, how many students are active, what's slow, and a plain-English 'what to do if it slows down' for staff.",
    href: "/admin/health",
  },
  {
    icon: "📣",
    title: "Campaigns",
    desc: "Schedule marketing posts once — Telegram, Discord and WhatsApp go out automatically; Instagram & YouTube email you the ready-to-paste post at send time.",
    href: "/admin/broadcasts",
  },
  {
    icon: "🎫",
    title: "Support tickets",
    desc: "Every website & phone issue as a ticket — assign it to someone who calls the student, log the activity, resolve/close. Overdue tickets escalate automatically.",
    href: "/admin/tickets",
  },
  {
    icon: "▶️",
    title: "YouTube performance",
    desc: "Channel stats (views, likes, comments, subscribers) next to what YouTube actually sends the site — visits, leads and signups from your videos.",
    href: "/admin/youtube",
  },
  {
    icon: "📝",
    title: "Articles & SEO",
    desc: "Original AI-written study articles that bring Google traffic — a topic queue writes itself; edit, publish or unpublish anything.",
    href: "/admin/articles",
  },
  {
    icon: "📇",
    title: "Contacts & leads",
    desc: "Import contacts from Interakt/WhatsApp exports or call lists. Leads join WhatsApp campaigns and the phone system recognises them when they call.",
    href: "/admin/leads",
  },
  {
    icon: "🔍",
    title: "Student insights",
    desc: "Most-viewed topics, where doubts come from, how students found us — and the drop-off call-list (never started / inactive 14d+).",
    href: "/admin/insights",
  },
  {
    icon: "🧭",
    title: "Control sheet",
    desc: "Per subject & topic: what's uploaded (classes, notes, transcripts, MCQ/descriptive tests, MTP/RTP/papers, amendments) and what's missing.",
    href: "/admin/control-sheet",
  },
  {
    icon: "🔐",
    title: "Security (2FA)",
    desc: "Optional two-factor authentication for your admin login (switched off by default).",
    href: "/auth/mfa/setup",
  },
  {
    icon: "📥",
    title: "Offline downloads",
    desc: "Prepare encrypted 720p copies of classes so students can download & watch offline in the apps.",
    href: "/admin/offline",
  },
  {
    icon: "🛡️",
    title: "Group moderation",
    desc: "Review flagged messages, search all group chats, hide messages, ban/mute users — Telegram kept in sync.",
    href: "/admin/discussion",
  },
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
    icon: "📜",
    title: "Amendments & updates",
    desc: "Post amendments by course/subject/topic with video, notes & the attempts they apply to.",
    href: "/admin/amendments",
  },
  {
    icon: "🗓️",
    title: "Study planner",
    desc: "Set the rules the day-by-day study plan engine follows (stages, hours, speeds).",
    href: "/admin/planner",
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
    icon: "🎖️",
    title: "Result awards",
    desc: "Students who submitted their result (marksheet + photo) to claim an award — verify & approve; a growing feed of success stories.",
    href: "/admin/awards",
  },
  {
    icon: "💚",
    title: "Scholarships",
    desc: "Merit (marksheet ≤1yr, ≥55% → 15%) & need-based (→10%) applications; approve to auto-issue and email a discount coupon.",
    href: "/admin/scholarships",
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
    icon: "🧾",
    title: "GST & invoicing",
    desc: "GSTIN, rate & invoice settings. Gift-subscription transactions and downloadable invoices appear in Reports.",
    href: "/admin/billing",
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

async function loadStats() {
  const svc = createServiceClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const head = { count: "exact" as const, head: true };
  const [students, openings, doubts, questions, ai, storage, bunny] = await Promise.all([
    svc.from("profiles").select("id", head).eq("role", "student"),
    svc.from("job_listings").select("id", head).eq("status", "new"),
    svc.from("doubts").select("id", head).eq("status", "open"),
    svc.from("page_questions").select("id", head).eq("status", "open"),
    svc.from("ai_usage").select("cost_usd").gte("created_at", monthStart).limit(20000),
    svc.rpc("storage_usage"),
    getBunnyBilling(),
  ]);
  const aiMonth = (ai.data ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
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
    { label: "Open doubts", value: String(s.doubts), href: "/admin/inbox", alert: s.doubts > 0 },
    { label: "Open questions", value: String(s.questions), href: "/admin/inbox", alert: s.questions > 0 },
    { label: "AI cost (this month)", value: inr(s.aiMonth), href: "/admin/costs" },
    ...(s.bunnyMonth !== null ? [{ label: "Bunny (this month)", value: inr(s.bunnyMonth), href: "/admin/costs" }] : []),
    { label: "Storage used", value: `${s.storageMb.toFixed(1)} MB`, href: "/admin/costs" },
  ];
  const visibleCards = isSuper ? cards : cards.filter((c) => canPath(c.href));
  const visiblePanels = isSuper ? PANELS : PANELS.filter((p) => p.href && canPath(p.href));
  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🛠️ Admin dashboard"
        title="Admin dashboard"
        subtitle="Your control centre — key numbers at a glance, then everything to manage below. 🚀"
      />

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

      <div className="admin-cards">
        {visiblePanels.map((p) => {
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
