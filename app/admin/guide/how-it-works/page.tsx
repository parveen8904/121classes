import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import PrintButton from "@/app/components/PrintButton";
import { assertArea } from "@/lib/adminAccess";
import vercelConfig from "@/vercel.json";

export const dynamic = "force-dynamic";
export const metadata = { title: "How the whole thing works — Admin" };

// The map, not the manual.
//
// The other guide says how to USE each tile. This says how the parts fit
// together — what is indexed under what, where a student's paper actually goes,
// which address feeds the AI, what runs at night without anyone pressing
// anything. It exists because the founder said he will forget how we indexed it,
// and he is right to expect the answer to be written down rather than remembered.
//
// The schedule table is generated from vercel.json itself, so it cannot quietly
// go stale the way a hand-typed list would.

type Flow = {
  id: string;
  icon: string;
  title: string;
  intro: string;
  steps: { what: string; detail: string }[];
  note?: string;
};

const FLOWS: Flow[] = [
  {
    id: "shape",
    icon: "🗂️",
    title: "How the teaching content is indexed",
    intro:
      "Everything a student studies hangs off one four-level spine. Every other part of the site — the planner, the tests, the AI, the control sheet — reads that same spine, which is why a thing filed in the wrong place goes missing everywhere at once.",
    steps: [
      { what: "Course", detail: "CA Intermediate, CA Final. The top level. A student's course decides what they are shown anywhere on the site." },
      { what: "→ Subject", detail: "Advanced Accounting, FR, and so on. A plan is bought per subject, so this is also the unit that is sold." },
      { what: "→ Topic", detail: "A chapter. The unit the study planner counts in and the AI narrows to when answering a doubt about it." },
      { what: "→ Section", detail: "The individual item — one class, one note, one test, one paper. This is the level the video, the PDF and the questions actually live at." },
      { what: "Named groups", detail: "A \"Section\" in the sense of a named GROUP of content is a different thing (topic_groups). The `sections` table is the individual items — that naming is old and deliberately left alone." },
    ],
    note:
      "The control sheet reads this spine and tells you, per subject and topic, what is uploaded and what is missing. If something is not showing for students, look there before looking anywhere else.",
  },
  {
    id: "student",
    icon: "🎓",
    title: "What happens when a student arrives",
    intro: "From landing on the site to sitting in a class, this is the whole path.",
    steps: [
      { what: "Signs up", detail: "Account created, verification email sent. Passwords must have a capital, a lowercase, a digit and a symbol — generated ones follow the same rule." },
      { what: "Gets access", detail: "Either they pay (Razorpay), or you grant it in Admin → Enrolment, or it arrives through the Aldine bridge from aldine.edu.in. All three end in the same place: a subscription row." },
      { what: "Opens the portal", detail: "My Courses shows only what they hold. There is no bypass — access is checked server-side on every page, not hidden in the interface." },
      { what: "Makes a plan", detail: "The study planner asks for their exam date and builds a day-by-day plan backwards from it — exhaustive study first, then revisions, at the pace they choose." },
      { what: "Studies and is tested", detail: "Classes, notes, MCQ chapter tests and descriptive papers, all off the same spine above." },
      { what: "Asks doubts", detail: "Five a day on every plan, on whichever channel they prefer. See below — they all reach the same brain." },
    ],
  },
  {
    id: "papers",
    icon: "🖊️",
    title: "How a written paper gets marked",
    intro:
      "This is the part with the most moving pieces, and the one worth knowing by heart. Nothing a student receives has gone out unchecked by a person.",
    steps: [
      { what: "1. The student writes it", detail: "By hand, then scanned as ONE PDF. Either a test on the site, one of the mock papers, or any paper at all through the free checking page." },
      { what: "2. The AI marks it", detail: "Against YOUR approved answer key for that exact paper and the step-marking guide — never from the model's own knowledge. Marks are awarded step by step and the total is added up in code, not by the model, which is what stopped the same paper scoring 9, then 13, then 12." },
      { what: "3. Where the key comes from", detail: "Where the marking guide and the approved answer key disagree, the APPROVED KEY WINS. Marking is liberal, by your instruction." },
      { what: "4. A person verifies it", detail: "The copy lands on the Examiner desk. An examiner claims it — which locks it so two people cannot mark the same copy — reads the AI's marking, changes what they disagree with, and releases it." },
      { what: "5. The student gets it back", detail: "Only then. They see the marks written on their own pages plus the official typeset answers. Suggested answers to mock papers are never shown to students." },
    ],
    note:
      "The free checking page needs an account but no plan — that account is only so the checked copy can be returned to the right person.",
  },
  {
    id: "ai",
    icon: "🤖",
    title: "Where the AI's answers come from",
    intro:
      "There is one brain, and six doors into it. The answer to the same question is the same answer whichever door it came through.",
    steps: [
      { what: "The material", detail: "The AI repository — your transcripts, notes, books and past papers. An answer is built from that material, narrowed to the relevant topic, not from what the model happens to know." },
      { what: "When it cannot answer", detail: "It says so and hands the question to a person rather than inventing something. That hand-off is the design, not a failure." },
      { what: "What it will not touch", detail: "Partnership accounting is not taught here, so nothing is ever written about it — not a post, an article, a question or an example." },
      { what: "The six doors", detail: "The website's doubt box · Telegram, direct · Telegram study groups · WhatsApp · Discord · email." },
      { what: "You see everything", detail: "Every AI reply by email blind-copies you. Every answer on every channel is listed in the daily report that reaches you at 7 in the morning, and sits in the doubt report in Admin → Reports." },
    ],
    note:
      "On your personal WhatsApp number the AI drafts only — it never sends. Nothing goes out in your voice from that number without you pressing send.",
  },
  {
    id: "email",
    icon: "✉️",
    title: "How email works, in and out",
    intro:
      "This is the piece most easily forgotten, because two different domains are involved and only one of them is the one students see.",
    steps: [
      { what: "Going out", detail: "Everything the site sends leaves through Mailgun on caparveensharma.com — verification, resets, invoices, answers, reports." },
      { what: "Coming in — the trick", detail: "caparveensharma.com's mail belongs to Google Workspace, so Mailgun cannot receive on it. A SECOND domain, 121caclasses.com, has its MX pointed at Mailgun and exists only to receive." },
      { what: "The bridge", detail: "sir@caparveensharma.com and contact@caparveensharma.com both forward to inbox@121caclasses.com, keeping a copy in their own inbox. That one address is the whole inbound side." },
      { what: "What happens then", detail: "Mailgun's route hands the message to the site, which records it, then either answers it from the repository, treats an attachment as an answer book for the faculty, or passes it to a person." },
      { what: "Never answering itself", detail: "contact@ is also where the site sends its own alerts. Mail from our own addresses is recorded and left alone, or the site would answer itself and each answer would arrive again." },
    ],
    note:
      "Mailgun signs each incoming message with the webhook signing key — a DIFFERENT secret from the sending key. Verifying against the wrong one rejects every genuine message as a forgery, which is exactly what it did until it was found.",
  },
  {
    id: "money",
    icon: "💰",
    title: "How money moves",
    intro: "What a student pays and where that record ends up.",
    steps: [
      { what: "The price", detail: "Set per subject and duration on the price ladder; the tier (Bronze/Silver/Gold) decides what they can use. A timed sale takes a percentage off everything automatically." },
      { what: "The payment", detail: "Razorpay online, or granted by hand in Enrolment, or arriving through the Aldine bridge. Razorpay is a CROSS-CHECK only — it is never the sales register." },
      { what: "The register", detail: "Admin → Sales & orders is the record: every payment with the buyer's details, GST invoice and Excel export." },
      { what: "The invoice", detail: "GST-compliant, CGST+SGST within Delhi and IGST outside, at 18%, from the Delhi GSTIN. Gift purchases carry their own invoice too." },
      { what: "Books", detail: "Book orders flow into the warehouse: label PDFs printed, tracking IDs entered, dispatch marked." },
    ],
  },
  {
    id: "files",
    icon: "🗄️",
    title: "Where the files actually live",
    intro: "Three different homes, for three good reasons.",
    steps: [
      { what: "Video", detail: "Bunny Stream and YouTube. Never in the database — video is the one thing big enough to make everything else slow." },
      { what: "PDFs and images", detail: "Supabase Storage. The `media` bucket is public (things anyone may see); the `secure` bucket is private (paid material, student answer books)." },
      { what: "Everything else", detail: "The Supabase database in Mumbai — chosen for being physically close to the students." },
      { what: "The keys", detail: "Admin → Integrations, stored in the database. Those WIN over anything set in Vercel, so a corrected key pasted there actually takes effect." },
    ],
  },
];

// Human-readable cron expressions, in IST — the schedules in vercel.json are UTC.
function describe(expr: string): string {
  const [min, hour] = expr.split(" ");
  if (hour === "*") return min.startsWith("*/") ? `every ${min.slice(2)} minutes` : `hourly, at ${min} past`;
  if (min.startsWith("*/")) return `every ${min.slice(2)} minutes, in a window`;
  const h = Number(hour);
  if (!Number.isFinite(h)) return `${min} ${hour} UTC`;
  // UTC → IST is +5:30.
  const totalMin = h * 60 + Number(min) + 330;
  const ist = ((totalMin % 1440) + 1440) % 1440;
  const hh = Math.floor(ist / 60);
  const mm = ist % 60;
  const ampm = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm} IST`;
}

const CRON_PURPOSE: Record<string, string> = {
  "/api/cron/ai-digest": "Emails you every answer the AI gave yesterday, on every channel.",
  "/api/cron/grade-papers": "Picks up any submitted paper the AI has not marked yet.",
  "/api/cron/release-papers": "Releases copies the examiner has finished with.",
  "/api/cron/duty": "The duty round — settles what it can, writes to you only when a person is genuinely needed.",
  "/api/cron/backup-email": "The weekly database backup, zipped and emailed.",
  "/api/cron/backup-keys": "Keeps a copy of the keys safe.",
  "/api/cron/mock-papers": "Continues drafting any mock paper still being written.",
  "/api/cron/draft-solutions": "Drafts answer keys for papers that have none — nothing counts until you approve it.",
  "/api/repo-ingest": "Feeds new material into the AI repository.",
  "/api/cron/feed-hourly": "Pulls the news feed for your approval.",
  "/api/cron/govt-feed": "Pulls official/government updates.",
  "/api/articles-generate": "Writes the next SEO article in the queue.",
  "/api/cron/class-reminders": "Reminds students of a class before it starts.",
  "/api/cron/broadcasts": "Sends approved broadcasts.",
  "/api/cron/reengage": "Drafts bring-them-back emails — sent only after your team approves each one.",
  "/api/cron/tickets-escalate": "Escalates support tickets nobody has answered.",
  "/api/cron/warehouse-dispatch": "The day's dispatch list.",
  "/api/cron/zoho-post": "Posts approved entries to Zoho.",
  "/api/cron/topics-trends": "Weekly look at what students are studying most.",
  "/api/cron/offline-drain": "Prepares offline downloads.",
  "/api/cron/close-bucket": "Closes off the day's collected material.",
  "/api/cron/warm": "Keeps the site warm so the first visitor of the day is not the slow one.",
};

export default async function HowItWorksPage() {
  await assertArea(null);
  const crons = ((vercelConfig as { crons?: { path: string; schedule: string }[] }).crons ?? [])
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path));

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 880 }}>
      <AdminHero
        badge="🧭 How it works"
        title="How the whole thing works"
        subtitle="Not how to use each screen — that is the other guide. This is how the parts fit together: what is filed under what, where a paper goes, which address feeds the AI, and what runs at night on its own."
        back={{ href: "/admin/guide", label: "Admin guide" }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, alignItems: "center" }}>
        {FLOWS.map((f) => (
          <a key={f.id} className="btn small secondary" href={`#${f.id}`}>{f.icon} {f.title.replace(/^How (the )?/, "")}</a>
        ))}
        <a className="btn small secondary" href="#schedule">⏰ What runs on its own</a>
        <PrintButton />
      </div>

      {FLOWS.map((f) => (
        <div key={f.id} id={f.id} style={{ scrollMarginTop: 90 }}>
          <h2 className="admin-section-title" style={{ marginTop: 32 }}>{f.icon} {f.title}</h2>
          <p className="muted" style={{ margin: "4px 0 12px", fontSize: ".9rem", lineHeight: 1.6 }}>{f.intro}</p>
          <div style={{ display: "grid", gap: 8 }}>
            {f.steps.map((s) => (
              <div className="card" key={s.what} style={{ padding: "10px 14px" }}>
                <strong style={{ fontSize: ".92rem" }}>{s.what}</strong>
                <p style={{ margin: "4px 0 0", fontSize: ".88rem", lineHeight: 1.6 }}>{s.detail}</p>
              </div>
            ))}
          </div>
          {f.note && (
            <div className="notice" style={{ marginTop: 10, fontSize: ".86rem" }}>⚠️ {f.note}</div>
          )}
        </div>
      ))}

      <div id="schedule" style={{ scrollMarginTop: 90 }}>
        <h2 className="admin-section-title" style={{ marginTop: 32 }}>⏰ What runs on its own</h2>
        <p className="muted" style={{ margin: "4px 0 12px", fontSize: ".9rem", lineHeight: 1.6 }}>
          These run without anyone pressing anything. Read from the site&apos;s own schedule file, so this list is
          never out of date. Times shown in IST.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
            <thead>
              <tr>
                <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--muted)" }}>When</th>
                <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--muted)" }}>What it does</th>
              </tr>
            </thead>
            <tbody>
              {crons.map((c) => (
                <tr key={c.path} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{describe(c.schedule)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {CRON_PURPOSE[c.path] ?? c.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 32 }}>📌 The five things worth remembering</h2>
      <ol style={{ margin: "8px 0 0 18px", display: "grid", gap: 8, fontSize: ".9rem", lineHeight: 1.6 }}>
        <li>Content is <strong>Course → Subject → Topic → Section</strong>. Everything else reads that spine.</li>
        <li>No marked paper reaches a student until a <strong>person releases it</strong>.</li>
        <li>The AI answers only from <strong>your material</strong>, and hands over rather than inventing.</li>
        <li>Students write to <strong>sir@</strong> or <strong>contact@</strong>; both forward to <strong>inbox@121caclasses.com</strong>, which is the only address the AI reads.</li>
        <li>Keys live in <strong>Admin → Integrations</strong>, and they override anything set in Vercel.</li>
      </ol>

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 26 }}>
        Press Print above and choose &ldquo;Save as PDF&rdquo; to keep a copy. For how to operate each individual
        screen, see the <Link href="/admin/guide">admin guide</Link>.
      </p>
    </section>
  );
}
