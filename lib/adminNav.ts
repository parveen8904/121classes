// SINGLE source of truth for the admin panel's structure. The dashboard tiles
// AND the header nav both render from ADMIN_GROUPS, so they can never drift
// apart again (the founder found headers without tiles and tiles without
// headers — this file is the fix). Grouped by FUNCTION, per his instruction:
// fewer, more logical clusters instead of 30 loose tiles.

export type AdminPanel = { icon: string; title: string; desc: string; href: string };
export type AdminGroup = { id: string; icon: string; title: string; tagline: string; panels: AdminPanel[] };

export const ADMIN_GROUPS: AdminGroup[] = [
  {
    id: "marketing",
    icon: "📣",
    title: "Marketing & communication",
    tagline: "Every way you reach students and the world — campaigns, contacts, content, announcements.",
    panels: [
      { icon: "📣", title: "Campaigns", desc: "Schedule marketing posts once — Telegram, Discord & WhatsApp post automatically; Instagram & YouTube are emailed ready-to-paste. Weekly autopilot writes the week for you.", href: "/admin/broadcasts" },
      { icon: "📇", title: "Contacts & leads", desc: "Import contacts (Interakt/CSV/call lists); leads join WhatsApp campaigns and the phone system recognises them.", href: "/admin/leads" },
      { icon: "📝", title: "Articles & SEO", desc: "Original AI-written study articles that bring Google traffic — topic queue refreshes weekly from accounting-world news.", href: "/admin/articles" },
      { icon: "▶️", title: "YouTube performance", desc: "Channel stats next to what YouTube actually sends the site — visits, leads and signups from your videos.", href: "/admin/youtube" },
      { icon: "📨", title: "Notify students", desc: "One-off notice to your own students by Telegram, email & WhatsApp (service messages — not marketing).", href: "/admin/notifications" },
      { icon: "🗞️", title: "Announcements", desc: "Official notices inside the portal — what's new, student corner, industry & macro updates.", href: "/admin/announcements" },
      { icon: "📜", title: "Amendments & updates", desc: "Post amendments by course/subject/topic with video, notes & the attempts they apply to.", href: "/admin/amendments" },
    ],
  },
  {
    id: "students",
    icon: "🎓",
    title: "Students & support",
    tagline: "Accounts, access, doubts, tickets, moderation — and their successes.",
    panels: [
      { icon: "👥", title: "Users", desc: "View, edit & manage every account — roles, attempts, contact details, staff rights.", href: "/admin/users" },
      { icon: "🎟️", title: "Enrolment", desc: "Grant course access (single or bulk) for any tier/duration; revoke & extend.", href: "/admin/enrolment" },
      { icon: "📥", title: "Inbox & doubts", desc: "Student doubts and page questions — answer, assign to faculty, or let the AI draft.", href: "/admin/inbox" },
      { icon: "🎫", title: "Support tickets", desc: "Website & phone issues as tickets — assign, call, log activity, resolve; overdue tickets escalate automatically.", href: "/admin/tickets" },
      { icon: "🛡️", title: "Group moderation", desc: "Flagged messages, search all group chats, hide/ban/mute — Telegram kept in sync.", href: "/admin/discussion" },
      { icon: "🔍", title: "Student insights", desc: "Most-viewed topics, where doubts come from, how students found us, drop-off call-list.", href: "/admin/insights" },
      { icon: "💚", title: "Scholarships", desc: "Merit & need-based applications; approve to auto-issue an emailed discount coupon.", href: "/admin/scholarships" },
      { icon: "🏆", title: "Results", desc: "Showcase rank-holders & toppers — the #1 trust signal for CA students.", href: "/admin/results" },
      { icon: "🎖️", title: "Result awards", desc: "Students claiming an award with marksheet + photo — verify & approve; a feed of success stories.", href: "/admin/awards" },
      { icon: "🎓", title: "Student placement", desc: "Auto-pulled CA openings — categorise & approve to publish on the Career page.", href: "/admin/placement" },
      { icon: "🧭", title: "Career corner", desc: "Career-page content — interviews, CV tips, guidance articles.", href: "/admin/content" },
    ],
  },
  {
    id: "teaching",
    icon: "📚",
    title: "Teaching & content",
    tagline: "Courses, classes, the AI repository and everything students study.",
    panels: [
      { icon: "📘", title: "Courses & content", desc: "Create courses → subjects → topics → sections, including homework & discussion.", href: "/admin/courses" },
      { icon: "📚", title: "AI repository", desc: "Feed the AI: transcripts, notes, books, RTP/MTP/papers — coverage panel shows what's missing.", href: "/admin/repository" },
      { icon: "🗓️", title: "Study planner", desc: "Set the rules the day-by-day study plan engine follows (stages, hours, speeds).", href: "/admin/planner" },
      { icon: "📡", title: "Live classes", desc: "Schedule live sessions (white-label Zoom or link) and attach recordings after.", href: "/admin/live" },
      { icon: "🧭", title: "Control sheet", desc: "Per subject & topic: what's uploaded and what's missing — classes, notes, tests, papers.", href: "/admin/control-sheet" },
      { icon: "📥", title: "Offline downloads", desc: "Prepare encrypted 720p copies so students can download & watch offline in the apps.", href: "/admin/offline" },
      { icon: "👩‍🏫", title: "Faculty", desc: "Add faculty (name, photo, bio) and assign them to subjects.", href: "/admin/faculty" },
    ],
  },
  {
    id: "money",
    icon: "💰",
    title: "Sales & money",
    tagline: "Pricing, discounts, the book store, invoices and revenue.",
    panels: [
      { icon: "💳", title: "Plans & pricing", desc: "Bronze/Silver/Gold per-month prices; duration discounts; web vs app.", href: "/admin/plans" },
      { icon: "🏷️", title: "Coupons", desc: "Run % or flat-amount discount codes applied at checkout — create, edit, email to sponsors.", href: "/admin/coupons" },
      { icon: "🎁", title: "Combos", desc: "Bundle several subjects at one discounted price.", href: "/admin/combos" },
      { icon: "📦", title: "Books", desc: "Manage the book catalogue, prices and stock for the store.", href: "/admin/books" },
      { icon: "🚚", title: "Book orders", desc: "Fulfil paid orders — view delivery details and mark dispatched.", href: "/admin/orders" },
      { icon: "🧾", title: "GST & invoicing", desc: "GSTIN, rate & invoice settings; transactions and downloadable invoices in Reports.", href: "/admin/billing" },
      { icon: "📊", title: "Reports", desc: "Revenue, active plans, book sales and dispatch snapshot.", href: "/admin/reports" },
    ],
  },
  {
    id: "system",
    icon: "⚙️",
    title: "System & settings",
    tagline: "Health, integrations, keys, costs and the website itself.",
    panels: [
      { icon: "🩺", title: "Server health", desc: "Live traffic, visitors (with time-on-site & phone), slow points, and plain-English fixes for staff.", href: "/admin/health" },
      { icon: "🔌", title: "Integrations", desc: "All API keys in one place — Telegram, WhatsApp, IVR, Zoom, Mailgun, Razorpay, AI, YouTube, storage.", href: "/admin/integrations" },
      { icon: "✈️", title: "Telegram tools", desc: "Bot setup, channel & group linking, member checks.", href: "/admin/telegram" },
      { icon: "🗄️", title: "Storage", desc: "Files in Supabase/R2 buckets — browse, clean up, see what's using space.", href: "/admin/storage" },
      { icon: "🖼️", title: "Site images", desc: "Founder photo, homepage banner, and the site's social/contact links.", href: "/admin/site" },
      { icon: "💰", title: "Costs & usage", desc: "AI, Bunny, Cloudflare & Supabase costs in one place.", href: "/admin/costs" },
      { icon: "🤖", title: "AI usage detail", desc: "Token spend by feature & model; monthly cap & alert; per-feature on/off switches.", href: "/admin/ai-usage" },
      { icon: "🔐", title: "Security (2FA)", desc: "Optional two-factor authentication for your admin login.", href: "/auth/mfa/setup" },
      { icon: "📖", title: "Admin guide", desc: "How to use every function of this panel, step by step — printable for your team.", href: "/admin/guide" },
    ],
  },
];
