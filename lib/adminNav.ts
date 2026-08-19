// SINGLE source of truth for the admin panel's structure. The dashboard tiles
// AND the header nav both render from ADMIN_GROUPS, so they can never drift
// apart again (the founder found headers without tiles and tiles without
// headers — this file is the fix). Grouped by FUNCTION, per his instruction:
// fewer, more logical clusters instead of 30 loose tiles.

export type AdminPanel = { icon: string; title: string; desc: string; href: string };
export type AdminGroup = { id: string; icon: string; title: string; tagline: string; panels: AdminPanel[] };

// The READING pages, gathered.
//
// A good number of the panel's tiles were not things you do — they were things
// you read, and they were scattered: server health under Settings, the doubt log
// two clicks inside Messages, "Reports" meaning only the money. They are listed
// here once and rendered on /admin/reports, so the panel itself carries fewer,
// more purposeful tiles.
export const REPORTS: AdminPanel[] = [
  { icon: "💰", title: "Sales report", desc: "Revenue in total and this month, split between subscriptions and books; active plans by tier; top-selling titles; gift purchases with their GST breakup and invoices.", href: "/admin/reports/sales" },
      { icon: "🧮", title: "Accounts & Zoho", desc: "For the accounts department: every sale with its invoice, receipt, Razorpay reference and Zoho status, filtered by date and state — plus Export Invoice and Export Payment. Separate from the sales Excel, which is unchanged.", href: "/admin/accounts" },
  { icon: "📄", title: "Paper report", desc: "Answer books day by day: how many arrived, how many students tried and could not upload, how many came back to read their marks, and how many opened the checked copy. The failed column is the one to watch — a student who cannot send a paper rarely writes in.", href: "/admin/reports/papers" },
  { icon: "🏆", title: "Leaderboards — who to mentor", desc: "A board for each thing with its leader named: classes played, planner ticked, mock papers, descriptive papers, marks as a percentage, case-study and MCQ toppers. Filter by exam attempt, phone and email on every row.", href: "/admin/reports/toppers" },
  { icon: "📱", title: "Who is using the app", desc: "Everyone who has opened the phone app and signed in — by name, with phone and email, iPhone or Android, and whether notifications are on. Explains why this will always be lower than Apple's download count.", href: "/admin/reports/app-users" },
  { icon: "📝", title: "Feedback", desc: "What students say about us — the complaints first, in their own words, with a way to reach them. Averages underneath, worst question first.", href: "/admin/reports/feedback" },
  { icon: "💬", title: "Doubt report", desc: "Every doubt on every channel: how many were answered, how many are still waiting and for how long, then the full question-and-answer record. The only doubt list there is.", href: "/admin/doubt-log" },
  { icon: "🎓", title: "Subscriber report", desc: "Who holds a live plan right now — tier, subject, dates, amount and full contact details, ready to export.", href: "/admin/reports/subscribers" },
  { icon: "🧾", title: "Orders report", desc: "Every payment received — subscriptions, extensions and books — with buyer details, GST invoices and dispatch state.", href: "/admin/orders" },
  { icon: "💚", title: "Supporters & their orders", desc: "Who sponsors students here, how many each has paid for, and every sponsorship order with its invoice and GST split.", href: "/admin/reports/supporters" },
  { icon: "📇", title: "Leads report", desc: "Every enquiry with name, phone, email and source — and whether it became a student.", href: "/admin/reports/leads" },
  { icon: "📲", title: "Phone verifications", desc: "Every login OTP: who it went to, on which channel, and whether it was entered — day by day. A code never entered usually never arrived.", href: "/admin/reports/otp" },
  { icon: "🎬", title: "Offline encoding queue", desc: "What the encoder finished today and yesterday, what is waiting and what failed — put a class first, or run one now instead of waiting for tonight.", href: "/admin/reports/encoding" },
  { icon: "🩺", title: "Server health & visitors", desc: "Whether the site is well: who is on it now, traffic over the week and month, the queries costing the most time, and plain-English fixes.", href: "/admin/health" },
  { icon: "🔍", title: "Student insights", desc: "What students actually study: most-viewed topics, where doubts come from, how they found us, and who has gone quiet.", href: "/admin/insights" },
  { icon: "💸", title: "Cost report", desc: "What the business is spending on AI, Bunny, Cloudflare and Supabase — one figure per provider.", href: "/admin/costs" },
  { icon: "🤖", title: "AI usage report", desc: "Token spend by feature and model against the monthly cap — which part of the AI is costing what.", href: "/admin/ai-usage" },
  { icon: "▶️", title: "YouTube report", desc: "Channel figures beside what YouTube actually sends the site — visits, leads and signups traced back to the videos.", href: "/admin/youtube" },
  { icon: "🗄️", title: "Backup report", desc: "What is saved and when it last ran — read from the actual files, so \"there is a backup\" is never a guess.", href: "/admin/backups" },
];

export const ADMIN_GROUPS: AdminGroup[] = [
  // Reading comes first. Opening the panel should start with "how is everything
  // doing", not with a wall of things to change.
  {
    id: "reports",
    icon: "📊",
    title: "Reports",
    tagline: "How everything is doing — the business, the students and the machinery. Read-only.",
    panels: REPORTS,
  },
  {
    id: "marketing",
    icon: "📣",
    title: "Marketing & communication",
    tagline: "Every way you reach students and the world — campaigns, contacts, content, announcements.",
    panels: [
      { icon: "📣", title: "Marketing & campaigns", desc: "Everything that goes out: build a campaign from a news item, an article, an event or a festival; the weekly autopilot; articles & SEO; and what your team still has to post by hand.", href: "/admin/campaigns" },
      { icon: "🗂️", title: "A run of posts", desc: "Several posts to one place, each on its own day — seven for X across a week, four for LinkedIn across a month. Different wording each time, unlike a campaign, which puts one message everywhere at once.", href: "/admin/campaigns/series" },
      { icon: "🗓️", title: "The posting week", desc: "Next week's recommended plan — LinkedIn/Medium/Substack on Wednesday and Friday, Instagram and Facebook every other day, a line on X daily, video on Monday, Thursday and Saturday, and the fortnightly Nova Seed voice call. Every slot arrives with a subject; amend what you like and send the rest to the queue.", href: "/admin/social-plan" },
      { icon: "📄", title: "Free downloads (SEO)", desc: "Which PDFs get a public page on caparveensharma.com so Google credits us — and the title it shows for each.", href: "/admin/notes" },
      { icon: "📱", title: "Students in your phone", desc: "Download every student as phone contacts (.vcf) — open it on the phone and calls arrive with a name instead of a number. Take the whole list once, then the daily top-up so nothing duplicates.", href: "/admin/contacts?days=1" },
      { icon: "📇", title: "Contacts & leads", desc: "Import contacts (Interakt/CSV/call lists); leads join WhatsApp campaigns and the phone system recognises them.", href: "/admin/leads" },
      { icon: "🔁", title: "Re-engagement", desc: "Bring-them-back emails for students who never started or went quiet — drafted nightly, sent ONLY after your team approves each one.", href: "/admin/reengage" },
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
      { icon: "🤝", title: "Mentoring desk", desc: "Who needs a word today, one student at a time, with their own figures in front of you — never signed in, went quiet, studying but not testing, marks slipping, validity running out. Nothing sends by itself: every message is drafted and waits for you, and every call outcome is logged so nobody is chased twice.", href: "/admin/mentoring" },
      { icon: "🎟️", title: "Enrolment", desc: "Grant course access (single or bulk) for any tier/duration; revoke & extend.", href: "/admin/enrolment" },
      { icon: "✉️", title: "Emails", desc: "Everything email in one place: how many went out and whether they arrived (Mailgun's own counts), what triggers every message, and the words of each — edit any of them.", href: "/admin/emails" },
      // Three tiles for one job — read what students asked and answer it —
      // meant guessing which of them held the message you were looking for.
      // One door now; the three desks are inside it.
      { icon: "✅", title: "Office tasks", desc: "Post a job and it lands on someone's list. They finish it, add a remark, or pass it on — and every hand-off stays on the record.", href: "/admin/tasks" },
      { icon: "💬", title: "WhatsApp inbox", desc: "The conversations students have on the business number — read and replied to here, and where you connect your own number. What was asked and answered on every channel is in the doubt report, under Reports.", href: "/admin/whatsapp" },
      { icon: "🖊️", title: "Examiner desk", desc: "Verify AI-checked descriptive copies and release them to students — sortable by subject/test; copies lock while an examiner checks.", href: "/examiner" },
      { icon: "🎫", title: "Support tickets", desc: "Website & phone issues as tickets — assign, call, log activity, resolve; overdue tickets escalate automatically.", href: "/admin/tickets" },
      { icon: "🛡️", title: "Group moderation", desc: "Flagged messages, search all group chats, hide/ban/mute — Telegram kept in sync.", href: "/admin/discussion" },
      { icon: "💚", title: "Scholarships", desc: "Merit & need-based applications; approve to auto-issue an emailed discount coupon.", href: "/admin/scholarships" },
      { icon: "🏆", title: "Results", desc: "Showcase rank-holders & toppers — the #1 trust signal for CA students.", href: "/admin/results" },
      { icon: "🎖️", title: "Result awards", desc: "Students claiming an award with marksheet + photo — verify & approve; a feed of success stories.", href: "/admin/awards" },
      { icon: "📇", title: "Student CV bank", desc: "Profiles and resumes students keep at /career/profile — tick candidates and send them to an employer with resumes attached. Only students who ticked the sharing consent are offered.", href: "/admin/cvs" },
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
      { icon: "📄", title: "Mock test papers", desc: "Full 100-mark papers in the ICAI pattern — 30 marks case-scenario MCQs, 70 descriptive. Drafted from past exam patterns; nothing reaches a student until you approve it.", href: "/admin/mock-papers" },
      { icon: "🗝️", title: "Answer keys", desc: "AI-drafted solutions for uploaded papers that have no answer key — read, edit, approve. Approved keys are what students see and what the AI marks descriptive papers against.", href: "/admin/solutions" },
      { icon: "📚", title: "AI repository", desc: "Feed the AI: transcripts, notes, books, RTP/MTP/papers — coverage panel shows what's missing.", href: "/admin/repository" },
      { icon: "🎓", title: "Teach the AI", desc: "Correct it once and it stays corrected. Standing rules it must always follow, and answers it got wrong — applied on every channel before it replies to anybody.", href: "/admin/ai-training" },
      { icon: "🗓️", title: "Study planner", desc: "Set the rules the day-by-day study plan engine follows (stages, hours, speeds).", href: "/admin/planner" },
      { icon: "📡", title: "Live classes", desc: "Schedule live sessions (white-label Zoom or link) and attach recordings after.", href: "/admin/live" },
      { icon: "📅", title: "Class schedule", desc: "Plan up to 100 recorded classes at fixed times — each day the studio plays the scheduled class on Zoom for the batch.", href: "/admin/schedule" },
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
      { icon: "💳", title: "Plans & pricing", desc: "The tiers themselves: names, on/off, Silver's flat price, gift pricing. Gold AMOUNTS live on each subject's Duration price ladder.", href: "/admin/plans" },
      { icon: "🔑", title: "Access & limits", desc: "Set per plan how much of each thing a student can use (classes, tests, doubts…). Free-trial caps, upgrade locks — mark it yourself.", href: "/admin/access" },
      { icon: "🏷️", title: "Coupons", desc: "Run % or flat-amount discount codes applied at checkout — create, edit, email to sponsors.", href: "/admin/coupons" },
      { icon: "🎉", title: "Sale", desc: "Run a limited-time sale: start & end dates, a discount % that comes off every price automatically, and homepage/plans banners.", href: "/admin/sale" },
      { icon: "🎁", title: "Combos", desc: "Bundle several subjects at one discounted price.", href: "/admin/combos" },
      { icon: "📦", title: "Books", desc: "Manage the book catalogue, prices and stock for the store.", href: "/admin/books" },
      { icon: "💳", title: "Sales & orders", desc: "EVERY payment received — subscriptions, extensions & books — with full buyer details, GST invoices, Excel download, Zoho approval and book dispatch.", href: "/admin/orders" },
      { icon: "🚩", title: "Supporter compliance", desc: "Complaints one seller made about another, what reading their websites found — more than 5% off, or our subject bundled into somebody else's combo — and the accounts on hold until the ₹5,000 penalty.", href: "/admin/supporters" },
      { icon: "🌉", title: "Aldine bridge", desc: "Courses sold on aldine.edu.in open here automatically — map each Aldine product to a course, watch every order arrive.", href: "/admin/aldine" },
      { icon: "💚", title: "Supporter desk (see what a vendor sees)", desc: "Open a vendor's own screen — their orders, their 25% code, the order form they use. For answering \"it looks wrong on my side\" without guessing.", href: "/supporter" },
      { icon: "🏭", title: "Warehouse & shipping", desc: "Parcels to courier — book orders + FREE Gold book sets. Print label PDFs, enter tracking IDs. Grant this area to your warehouse user.", href: "/admin/warehouse" },
      { icon: "🧾", title: "GST & invoicing", desc: "GSTIN, rate & invoice settings; transactions and downloadable invoices in Reports.", href: "/admin/billing" },
    ],
  },
  {
    id: "system",
    icon: "⚙️",
    title: "System & settings",
    tagline: "Health, integrations, keys, costs and the website itself.",
    panels: [
      { icon: "🔌", title: "Integrations", desc: "All API keys in one place — Telegram, WhatsApp, IVR, Zoom, Mailgun, Razorpay, AI, YouTube, storage.", href: "/admin/integrations" },
      { icon: "✈️", title: "Telegram tools", desc: "Bot setup, channel & group linking, member checks.", href: "/admin/telegram" },
      { icon: "🗄️", title: "Storage", desc: "Files in Supabase/R2 buckets — browse, clean up, see what's using space.", href: "/admin/storage" },
      { icon: "🖼️", title: "Site images", desc: "Founder photo, homepage banner, and the site's social/contact links.", href: "/admin/site" },
      { icon: "🔐", title: "Security (2FA)", desc: "Optional two-factor authentication for your admin login.", href: "/auth/mfa/setup" },
      { icon: "📖", title: "Admin guide", desc: "How to use every function of this panel, step by step — printable for your team.", href: "/admin/guide" },
    ],
  },
];
