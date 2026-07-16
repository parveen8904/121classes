import Link from "next/link";
import PrintButton from "@/app/components/PrintButton";

export const revalidate = 3600;
export const metadata = {
  title: "Student Guide — how to use the portal | CA Parveen Sharma",
  description: "Step-by-step guide to everything on caparveensharma.com — free study planner, classes, tests with AI evaluation, case scenarios, doubts, live classes and more.",
  alternates: { canonical: "/guide" },
};

// The student handbook: every feature with plain-language steps. Public on
// purpose — it doubles as a feature tour for students who haven't joined yet.
type Section = { id: string; icon: string; title: string; items: { title: string; steps: string[]; tip?: string }[] };

const SECTIONS: Section[] = [
  {
    id: "start",
    icon: "🚀",
    title: "Getting started",
    items: [
      {
        title: "Create your free account",
        steps: [
          "Go to the Login page → Register, or start from the free planner page.",
          "Enter your name, email and WhatsApp number, then open the verification email we send and click the link.",
          "Choose your password — you're in.",
          "The one-time setup asks your course (Foundation / Inter / Final), subjects and exam attempt — this personalises everything, so answer carefully. You can change it later from your profile.",
        ],
        tip: "No verification email? Check spam, then use “Resend” on the login page.",
      },
      {
        title: "Your dashboard",
        steps: [
          "After login you land on the dashboard: your courses, today's plan, announcements, live classes and community links in one place.",
          "Anything marked 🆓 works without payment — the planner, chapter tests and case practice are free.",
        ],
      },
    ],
  },
  {
    id: "planner",
    icon: "📅",
    title: "Free study planner",
    items: [
      {
        title: "Build your day-by-day plan (2 minutes, free)",
        steps: [
          "Open Planner from the dashboard (or caparveensharma.com/free-planner before login).",
          "Pick your exam attempt and how many hours you can study daily.",
          "The engine maps every day from today to your exam: which classes to watch, when your first and second revisions happen, and practice slots.",
          "Follow it daily — the plan shows exactly today's work. If you fall behind, rebuild the plan with your new dates; it recalculates honestly (it will tell you frankly if time is short).",
        ],
      },
    ],
  },
  {
    id: "classes",
    icon: "🎥",
    title: "Classes & notes",
    items: [
      {
        title: "Watching classes",
        steps: [
          "Open your course → subject → topic → class. The player remembers where you stopped.",
          "We recommend 1.25× speed — durations shown already assume it.",
          "Below the player: the class notes (PDF) and a doubt box — ask right there and the AI (or faculty) answers.",
        ],
      },
      {
        title: "Downloading for offline",
        steps: [
          "Classes with a download button can be saved in our desktop app (Windows/Mac) and watched without internet.",
          "Downloads are encrypted and play only in the app, only for your account.",
        ],
      },
    ],
  },
  {
    id: "tests",
    icon: "📝",
    title: "Tests & practice",
    items: [
      {
        title: "Chapter MCQ tests (free)",
        steps: [
          "Every chapter has timed MCQ tests. Start one — the question navigator shows answered/unanswered; the timer auto-submits at the end.",
          "Your report shows score, rank among all students, the concepts you got wrong, and which classes to re-watch.",
          "You can attempt a test multiple times — the report tracks improvement.",
        ],
      },
      {
        title: "Descriptive (written) tests with AI evaluation",
        steps: [
          "Open a descriptive test → either type your answer, or write on paper and upload a photo/PDF of your handwritten answer.",
          "The AI marks it against the model answer and returns marks with step-wise feedback — where you lost marks and why.",
        ],
      },
      {
        title: "Practice papers — RTP / MTP / past exam papers",
        steps: [
          "Under your subject you'll find RTPs, MTPs and past papers for your attempt.",
          "Papers marked “✅ has suggested answers” support AI evaluation: attempt the paper, upload your answer sheet, get marked feedback.",
        ],
      },
      {
        title: "Case scenarios (the new exam pattern)",
        steps: [
          "Open Case Studies under your subject: read the case, answer its MCQs, and see explanations instantly.",
          "Attempt cases as many times as you like — they're built for repetition.",
        ],
      },
    ],
  },
  {
    id: "doubts",
    icon: "💬",
    title: "Doubts & help",
    items: [
      {
        title: "Asking a doubt",
        steps: [
          "Fastest: the doubt box under any class — the AI answers in seconds (marked as beta); tricky ones go to faculty.",
          "In the Telegram subject groups, TAG the bot (@ mention) or reply to it — it answers only when called, never interrupts discussions.",
          "The “Ask me” box on the site answers questions about the platform itself.",
        ],
      },
      {
        title: "Something not working? (support)",
        steps: [
          "Go to caparveensharma.com/support (also linked in the footer), describe the issue with your phone number.",
          "You get a ticket number instantly by email, and our team calls you back.",
        ],
      },
    ],
  },
  {
    id: "live",
    icon: "📡",
    title: "Live classes & community",
    items: [
      {
        title: "Joining a live class",
        steps: [
          "Open Live from the dashboard — upcoming sessions are listed with a Join button at start time.",
          "Most live classes play right inside the website. Recordings appear on the same page afterwards.",
          "Press “Notify me” on a session to get a reminder email before it starts.",
        ],
      },
      {
        title: "Community groups",
        steps: [
          "Your dashboard shows the Telegram channel, your subject groups, and Discord — join with one tap.",
          "Groups are members-only and moderated; be kind, no spam, no piracy.",
        ],
      },
    ],
  },
  {
    id: "payments",
    icon: "💳",
    title: "Plans, payments & gifts",
    items: [
      {
        title: "Buying a subscription",
        steps: [
          "Open Courses → your subject → choose a tier (Bronze/Silver/Gold) and duration.",
          "Have a coupon or scholarship code? Enter it on the payment step — the discount applies instantly.",
          "Payment is by UPI/card/net-banking; access activates immediately after payment.",
        ],
      },
      {
        title: "Scholarships",
        steps: [
          "Scored 55%+ in your last CA exam within a year? Apply with your marksheet for a 15% scholarship; a need-based 10% is also available.",
          "Approved scholarships arrive as a coupon on your email.",
        ],
      },
      {
        title: "Gift a subscription (Sponsor a Student)",
        steps: [
          "Anyone can gift a Gold subscription to a student from the Gift page — the student never sees the amount paid.",
          "The sponsor receives a GST invoice and the Sponsor Guide by email; the student receives simple login steps.",
        ],
      },
      {
        title: "Books",
        steps: [
          "Order printed books from the store; delivery details at checkout, dispatch updates by email.",
        ],
      },
    ],
  },
  {
    id: "career",
    icon: "🧭",
    title: "Career & results",
    items: [
      {
        title: "Career corner",
        steps: [
          "Browse verified CA job/articleship openings on the Career page.",
          "Practice with the AI mock interview and polish your CV summary with AI help.",
        ],
      },
      {
        title: "Cleared your exam? Claim your award",
        steps: [
          "Submit your result with marksheet and photo on the Results page — approved entries join the wall of success stories (and there's an award!).",
        ],
      },
    ],
  },
  {
    id: "apps",
    icon: "📱",
    title: "Apps & devices",
    items: [
      {
        title: "Using the apps",
        steps: [
          "The website works on any phone browser. The desktop app (Windows/Mac) adds offline class downloads — get it from the Download page.",
          "Mobile apps are on their way to the app stores.",
          "Your account works on a limited number of devices at a time — if you change phones, log out from the old one first.",
        ],
      },
    ],
  },
];

export default function StudentGuidePage() {
  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
        <span className="badge">📖 Student guide</span>
        <h1 style={{ marginTop: 10 }}>How to use the portal</h1>
        <p className="meta" style={{ marginTop: 8 }}>
          Everything on caparveensharma.com, explained step by step — from your free study plan to AI-checked answer sheets.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
          {SECTIONS.map((s) => (
            <a key={s.id} className="btn small secondary" href={`#${s.id}`}>{s.icon} {s.title}</a>
          ))}
          <PrintButton />
        </div>

        {SECTIONS.map((s) => (
          <div key={s.id} id={s.id} style={{ scrollMarginTop: 90 }}>
            <h2 className="admin-section-title" style={{ marginTop: 28 }}>{s.icon} {s.title}</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {s.items.map((it) => (
                <details key={it.title} className="card">
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>{it.title}</summary>
                  <ol style={{ margin: "10px 0 8px 18px", display: "grid", gap: 6, fontSize: ".92rem" }}>
                    {it.steps.map((st, i) => <li key={i}>{st}</li>)}
                  </ol>
                  {it.tip && <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>💡 {it.tip}</p>}
                </details>
              ))}
            </div>
          </div>
        ))}

        <div className="card" style={{ marginTop: 28, textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>Still stuck?</h3>
          <p className="muted" style={{ fontSize: ".9rem" }}>Tell us what's wrong — we usually reply with a call.</p>
          <Link className="btn" href="/support">🎧 Get help →</Link>
        </div>
      </section>
    </main>
  );
}
