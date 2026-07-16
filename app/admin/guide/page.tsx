import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import PrintButton from "./PrintButton";
import { ADMIN_GROUPS } from "@/lib/adminNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin guide — how to use everything" };

// The staff handbook, keyed by each tile's href so it always mirrors the
// dashboard (lib/adminNav.ts). Every entry: what it's for + numbered steps in
// plain, non-technical language + an optional tip.
type Entry = { steps: string[]; tip?: string };

const GUIDE: Record<string, Entry> = {
  // ── 📣 Marketing & communication ─────────────────────────────────────────
  "/admin/broadcasts": {
    steps: [
      "To post once to many platforms: open '✍️ Schedule a campaign post', write the message, pick date & time (Indian time) and tick the channels. Telegram/Discord/WhatsApp send themselves; for Instagram/YouTube you receive an email with ready-to-paste text at post time.",
      "To let AI write a whole week: open '✨ Generate a campaign pack', choose what to promote and how many days — the posts land in 'Upcoming' where you can edit or delete any of them before they go out.",
      "For fully hands-free marketing: press '▶ Switch on autopilot' once. Every Monday morning the week's posts are written, scheduled for 7 pm daily, and emailed to you for review.",
      "To change a scheduled post: find it under '⏳ Upcoming' → '✏️ Edit this post' → change text or time → Save. To cancel it, use the delete button.",
    ],
    tip: "WhatsApp campaigns need an approved Interakt template (one-time setup) and send in batches of 400 every 10 minutes — big lists finish by themselves.",
  },
  "/admin/leads": {
    steps: [
      "To import contacts: choose the CSV file (e.g. Interakt's contact export) or paste lines like 'Rahul, 9812345678', pick where they're from, and press Import. Duplicates and existing students are detected automatically — nothing is added twice.",
      "To add one contact after a phone call: open '✍️ Add one lead by hand', fill name/phone/email and a note.",
      "Leads with a phone number automatically join your WhatsApp campaign audience, and when they call your IVR number their name appears on the ticket.",
    ],
    tip: "'✅ verified' leads confirmed their email and WhatsApp through the website popup — those are real, reachable people.",
  },
  "/admin/articles": {
    steps: [
      "The topic list ('📋 waiting to be written') fills itself: every Monday the trends scanner adds topics from the week's accounting news (ICAI, NFRA, SEBI, SFIO, scams). You can also add your own under '➕ Add article topics' — one line per topic.",
      "Articles write themselves in the background. Press '▶ Write now' to speed the queue up.",
      "To review an article: open it with 'View', and use '✏️ Edit article' to fix wording or add your insights. 'Unpublish' hides it instantly; 'Delete' removes it permanently.",
    ],
    tip: "Give technical articles (Ind AS topics) a 2-minute read when you can — your corrections make them truly yours, and Google rewards it.",
  },
  "/admin/youtube": {
    steps: [
      "One-time setup: on Integrations fill 'YouTube Data API key' and 'YouTube channel' (your channel link or @handle).",
      "The top row shows your channel (subscribers, views). The middle row is the important one: how many visits, leads and signups YouTube actually sent the website.",
      "Use the ?src=yt link (caparveensharma.com/free-planner?src=yt) in every video description and pinned comment — only tagged links are counted.",
    ],
    tip: "High views but low visits = the link isn't visible enough. Say it on camera at the moment of peak interest.",
  },
  "/admin/notifications": {
    steps: [
      "Use this for SERVICE messages to your own students (class shifted, portal downtime) — not marketing (that's Campaigns).",
      "Write the message, choose the channel (email / Telegram / WhatsApp) and the audience, then send.",
    ],
  },
  "/admin/announcements": {
    steps: [
      "These are notices students see INSIDE the portal — nothing is sent out.",
      "Create an announcement with a title, body and category (what's new / student corner / industry / macro); it appears on the student dashboard immediately.",
      "Delete or edit old ones from the list below the form.",
    ],
  },
  "/admin/amendments": {
    steps: [
      "Post syllabus amendments by course/subject/topic — attach a video link or notes PDF and select which attempts they apply to.",
      "Students see amendments on their course pages, filtered to their own attempt.",
    ],
  },

  // ── 🎓 Students & support ────────────────────────────────────────────────
  "/admin/users": {
    steps: [
      "Search any account by name/email; open it to edit contact details, attempt, or role.",
      "To give a team member admin-panel access: set their role to operator (staff) or faculty, then tick exactly the areas they may manage (e.g. only Support tickets). They'll see only those tiles.",
      "Students stay role 'student' — they never see the admin panel.",
    ],
  },
  "/admin/enrolment": {
    steps: [
      "To give a student course access manually (offline payment, gift, correction): pick the student, the subject/course, tier and duration, and grant.",
      "Bulk mode enrols a whole list at once. Existing access can be extended or revoked from the same screen.",
    ],
  },
  "/admin/inbox": {
    steps: [
      "All student doubts and page questions land here, newest first.",
      "Answer directly, or let the AI draft a reply and edit it before sending. Mark items resolved when done — open counts show on the dashboard.",
    ],
  },
  "/admin/tickets": {
    steps: [
      "Website 'Help & support' requests and phone calls (from your IVR) become tickets automatically. To log a call yourself: '＋ Log a ticket', fill what the student told you.",
      "Open a ticket → 'Assign to' the team member who will call the student (they get an email with the phone number).",
      "After each call press '📞 Log a call' and write what happened — the full history stays on the ticket.",
      "Move the status as you work: Open → In progress → Waiting on student → Resolved → Closed. Tickets left unresolved past their time limit escalate automatically and email the admins.",
    ],
    tip: "Priorities set the escalation clock: urgent 4h, high 12h, normal 48h, low 96h.",
  },
  "/admin/discussion": {
    steps: [
      "Review flagged group messages, search everything said in the groups, and hide any message (hides on Telegram too).",
      "Ban or mute repeat offenders; manage the blocked-terms list that auto-flags messages.",
    ],
  },
  "/admin/insights": {
    steps: [
      "Read-only intelligence: most-viewed topics, where doubts concentrate (weak chapters worth a revision video), how students found you, and the drop-off call-list (paid but never started / inactive 14+ days — call these students).",
    ],
  },
  "/admin/scholarships": {
    steps: [
      "Applications arrive with marksheet/photo proof. Approve merit (≥55% within a year → 15%) or need-based (→10%); approval automatically creates the coupon and emails the student.",
    ],
  },
  "/admin/results": {
    steps: [
      "Add rank-holders and toppers (name, rank, attempt, photo) — they show on the public Results page, your strongest trust signal.",
    ],
  },
  "/admin/awards": {
    steps: [
      "Students who submitted their result to claim an award appear here with marksheet and photo.",
      "Verify the marksheet, then approve — the story joins your public success-stories feed.",
    ],
  },
  "/admin/placement": {
    steps: [
      "CA job openings are pulled automatically and wait here for review.",
      "Approve the genuine ones — they publish on the public Career page. Reject the rest.",
    ],
  },
  "/admin/content": {
    steps: [
      "Manage the Career page's own content — guidance articles, interview prep, CV tips.",
    ],
  },

  // ── 📚 Teaching & content ────────────────────────────────────────────────
  "/admin/courses": {
    steps: [
      "Structure: Course → Subject → Topic → Sections (classes, notes, tests, homework).",
      "Open a subject to manage everything about it in one place: applicability attempts, chapter weightage, most-important-questions lists, RTP/MTP/past papers/ICAI uploads, custom content and case-study sets.",
      "Every uploaded item now has '✏️ Edit / replace' — rename, change attempt, swap the file, or add a suggested-answers PDF later (that switches on AI evaluation for students).",
      "Tick '🌐 Free sample' on an item to offer it as a public download to verified visitors (lead magnet).",
    ],
    tip: "For case-study sets: upload the PDF, let it parse, then press Publish. The newest published set also powers the website's free case-test popup.",
  },
  "/admin/repository": {
    steps: [
      "This feeds the AI that answers doubts and generates tests: transcripts, notes, books, question banks.",
      "The coverage panel shows exactly what's digested and what's missing per subject — fill the gaps and AI answers get better.",
    ],
  },
  "/admin/planner": {
    steps: [
      "Set the rules the day-by-day study-plan engine follows: stages (first study, revisions), daily hours, watch speeds.",
      "Changes apply to every plan students generate after you save.",
    ],
  },
  "/admin/live": {
    steps: [
      "Schedule a live class with title, faculty, date/time. For white-label (students watch on YOUR site, no Zoom link visible): paste the Zoom meeting number + passcode (needs Zoom SDK keys on Integrations).",
      "After class, paste the recording link on the same card so students can rewatch.",
    ],
  },
  "/admin/control-sheet": {
    steps: [
      "One table showing, per subject and topic, what's uploaded (classes, notes, transcripts, tests, papers, amendments) and what's missing — your content to-do list.",
    ],
  },
  "/admin/offline": {
    steps: [
      "Prepare encrypted 720p copies of classes so students can download and watch offline in the apps. Queue a class; it processes in the background.",
    ],
  },
  "/admin/faculty": {
    steps: [
      "Add each teacher with name, photo, bio, and assign them to their subjects — they appear on the public site and in live-class scheduling.",
    ],
  },

  // ── 💰 Sales & money ─────────────────────────────────────────────────────
  "/admin/plans": {
    steps: [
      "Set Bronze/Silver/Gold monthly prices per subject, and duration discounts. App-store pricing can differ from web.",
    ],
  },
  "/admin/coupons": {
    steps: [
      "Create a code with either % off or flat ₹ off, optional max uses, expiry, and who may use it (anyone / self-purchase / gifters).",
      "Lock a coupon to one email for a personal discount. '✏️ Edit coupon' changes anything later.",
      "'✉️ Send' emails the coupon — a gifter automatically receives the Sponsor Guide with it.",
    ],
  },
  "/admin/combos": {
    steps: [
      "Bundle several subjects at one discounted price; the combo shows as a single purchase option.",
    ],
  },
  "/admin/books": {
    steps: [
      "Manage the printed-book catalogue: title, price, stock, images. Out-of-stock books stop accepting orders automatically.",
    ],
  },
  "/admin/orders": {
    steps: [
      "Paid book orders arrive here with delivery details. Pack, dispatch, then mark dispatched — the student is notified.",
    ],
  },
  "/admin/billing": {
    steps: [
      "Your GST settings (GSTIN, rate, invoice numbering) used on every invoice. Delhi buyers get CGST+SGST, other states IGST — automatic from the buyer's state.",
    ],
  },
  "/admin/reports": {
    steps: [
      "Revenue, active plans, book sales and dispatch snapshot — with invoices downloadable per transaction.",
    ],
  },

  // ── ⚙️ System & settings ─────────────────────────────────────────────────
  "/admin/health": {
    steps: [
      "Your daily 30-second check: server load, visitors today (full list, longest time first, with phones for known students), signup failures, and plain-English 'what to do if slow' for staff.",
    ],
  },
  "/admin/integrations": {
    steps: [
      "Every external service's key lives here — paste once, the feature switches on. Green dot = working.",
      "Includes: Telegram bot, WhatsApp (Interakt) + template names, IVR webhook key (with the exact copy-paste URL), Zoom SDK, Mailgun email, Razorpay, AI key, YouTube key + channel, storage keys.",
    ],
    tip: "Blank fields are left unchanged when saving — you never lose a key by saving another. Type CLEAR to remove one.",
  },
  "/admin/telegram": {
    steps: [
      "Bot connection, channel and subject-group linking, and member checks for the members-only gate.",
    ],
  },
  "/admin/storage": {
    steps: [
      "Browse what's stored in your file buckets and clean up unused files if space grows.",
    ],
  },
  "/admin/site": {
    steps: [
      "Upload the founder photo and homepage banner; set the site's public contact and social links (these also power the floating WhatsApp/call buttons and the Google schema).",
    ],
  },
  "/admin/costs": {
    steps: [
      "AI, Bunny (video), Cloudflare and Supabase costs in one place — check monthly.",
    ],
  },
  "/admin/ai-usage": {
    steps: [
      "Token spend by feature and model, a monthly cap with email alert, and per-feature ON/OFF switches (e.g. pause the articles writer or marketing autopilot).",
    ],
  },
  "/auth/mfa/setup": {
    steps: [
      "Optional two-factor login for your own account. Off by default — enable only if you're comfortable with authenticator apps.",
    ],
  },
};

// The three look-alikes, explained once at the top of the Marketing section.
const MARKETING_NOTE =
  "Three tools look similar but do different jobs: CAMPAIGNS talks to the world (marketing posts to Telegram/Discord/WhatsApp/Instagram/YouTube). NOTIFY STUDENTS sends a one-off service message to your own enrolled students. ANNOUNCEMENTS post notices inside the portal — nothing is sent out.";

export default function AdminGuidePage() {
  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📖 Admin guide"
        title="How to use the admin panel"
        subtitle="Every function, in plain language, with steps — organised exactly like the dashboard. Share it with your team. 🧭"
        back={{ href: "/admin", label: "Admin" }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, alignItems: "center" }}>
        {ADMIN_GROUPS.map((g) => (
          <a key={g.id} className="btn small secondary" href={`#guide-${g.id}`}>{g.icon} {g.title}</a>
        ))}
        <PrintButton />
      </div>

      {ADMIN_GROUPS.map((g) => (
        <div key={g.id} id={`guide-${g.id}`} style={{ scrollMarginTop: 90 }}>
          <h2 className="admin-section-title" style={{ marginTop: 30 }}>{g.icon} {g.title}</h2>
          <p className="muted" style={{ margin: "4px 0 10px", fontSize: ".88rem" }}>{g.tagline}</p>
          {g.id === "marketing" && (
            <div className="notice ok" style={{ marginBottom: 10, fontSize: ".85rem" }}>{MARKETING_NOTE}</div>
          )}
          <div style={{ display: "grid", gap: 10 }}>
            {g.panels.filter((p) => p.href !== "/admin/guide").map((p) => {
              const entry = GUIDE[p.href];
              return (
                <details key={p.href} className="card">
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                    {p.icon} {p.title} <span className="muted" style={{ fontWeight: 400, fontSize: ".82rem" }}>— {p.desc}</span>
                  </summary>
                  <div style={{ marginTop: 10 }}>
                    {entry ? (
                      <>
                        <ol style={{ margin: "0 0 8px 18px", display: "grid", gap: 6, fontSize: ".9rem" }}>
                          {entry.steps.map((s, i) => <li key={i}>{s}</li>)}
                        </ol>
                        {entry.tip && <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>💡 {entry.tip}</p>}
                      </>
                    ) : (
                      <p className="muted" style={{ fontSize: ".85rem", margin: 0 }}>Guide entry coming soon.</p>
                    )}
                    <p style={{ marginTop: 10, marginBottom: 0 }}>
                      <Link className="btn small secondary" href={p.href}>Open {p.title} →</Link>
                    </p>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ))}

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 26 }}>
        To save this as a PDF for your team: press the Print button above and choose &ldquo;Save as PDF&rdquo;.
        The guide always matches the dashboard — when a new tile is added, its guide entry appears here.
      </p>
    </section>
  );
}
