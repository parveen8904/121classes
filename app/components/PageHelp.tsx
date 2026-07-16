"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

// The floating "?" on every page: tap it and a panel explains what each
// control on THIS page does, plus a link to the full guide. Content lives in
// one map here — path prefixes, most specific first.

type Help = { title: string; items: string[]; guide?: string };

const HELP: [string, Help][] = [
  // ── Student pages ──────────────────────────────────────────────────────────
  ["/dashboard", { title: "Your dashboard", items: [
    "📚 My courses — everything you've added or bought; tap to study.",
    "📅 Today's plan — what the study planner says to do today.",
    "🗞️ Announcements — official updates from CA Parveen Sharma.",
    "💬 Community — your Telegram/Discord groups, one tap to join.",
  ], guide: "/guide#start" }],
  ["/planner", { title: "Study planner", items: [
    "Pick your exam attempt + daily hours → the engine builds a day-by-day plan to your exam.",
    "Rebuild any time if you fall behind — it recalculates honestly.",
  ], guide: "/guide#planner" }],
  ["/learn/section", { title: "Class page", items: [
    "▶️ Player — remembers where you stopped; 1.25× speed recommended.",
    "📄 Notes — the PDF for this class.",
    "💬 Doubt box — ask here; AI answers in seconds, faculty reviews the hard ones.",
    "⬇️ Download — save for offline in the desktop app (where enabled).",
  ], guide: "/guide#classes" }],
  ["/learn/cases", { title: "Case scenarios", items: [
    "Read the case, answer each MCQ — explanations appear instantly.",
    "Attempt as many times as you like; each attempt is scored.",
  ], guide: "/guide#tests" }],
  ["/learn", { title: "Learning area", items: [
    "Course → subject → topic → classes. Locked items need a subscription; 🆓 items are free.",
    "Under each subject: RTP/MTP/past papers (✅ = upload your answers for AI marking) and case studies.",
  ], guide: "/guide#classes" }],
  ["/live", { title: "Live classes", items: [
    "🟢 Upcoming — Join appears at start time; most classes play right here on the site.",
    "🔔 Notify me — email reminder before the class.",
    "⏪ Past — recordings appear after the session.",
  ], guide: "/guide#live" }],
  ["/support", { title: "Help & support", items: [
    "Describe the problem + your phone number → you get a ticket number by email and our team calls you.",
  ], guide: "/guide#doubts" }],
  ["/gift", { title: "Gift a subscription", items: [
    "Choose the student & subject, pay — the student gets access without ever seeing the amount.",
    "You receive the GST invoice + Sponsor Guide by email.",
  ], guide: "/guide#payments" }],
  ["/free-planner", { title: "Free study plan", items: [
    "Fill name, email, WhatsApp + your exam → verify your email → build your day-by-day plan free.",
  ], guide: "/guide#planner" }],
  ["/articles", { title: "Study articles", items: [
    "Free exam-focused reading — standards explained, strategy, and this week's accounting news.",
  ] }],

  // ── Admin pages (staff) ────────────────────────────────────────────────────
  ["/admin/broadcasts", { title: "Campaigns", items: [
    "✍️ Schedule a post — one message, many platforms, at your chosen time.",
    "✨ Generate a pack — AI writes a multi-day campaign; you approve.",
    "▶ Autopilot — Monday mornings the week writes itself; you get the plan by email.",
  ], guide: "/admin/guide#guide-marketing" }],
  ["/admin/tickets", { title: "Tickets desk", items: [
    "＋ Log a ticket — record a phone-call issue.",
    "Assign to — who will call the student (they're emailed the number).",
    "📞 Log a call / 📝 note — every action stays on the ticket's history.",
    "Status buttons — Open → In progress → Waiting → Resolved → Closed.",
  ], guide: "/admin/guide#guide-students" }],
  ["/admin/leads", { title: "Contacts & leads", items: [
    "Import CSV or paste contacts — duplicates & existing students handled automatically.",
    "Leads join WhatsApp campaigns and are recognised when they call.",
  ], guide: "/admin/guide#guide-marketing" }],
  ["/admin/articles", { title: "Articles & SEO", items: [
    "📋 Topic list — waiting queue; refreshed every Monday from accounting news.",
    "▶ Write now — speed up the writer. ✏️ Edit / Unpublish on any article.",
  ], guide: "/admin/guide#guide-marketing" }],
  ["/admin/coupons", { title: "Coupons", items: [
    "Create % or ₹ codes; limit uses, expiry, or lock to one email.",
    "✏️ Edit changes anything later. ✉️ Send emails it (gifters get the Sponsor Guide automatically).",
  ], guide: "/admin/guide#guide-money" }],
  ["/admin/integrations", { title: "Integrations", items: [
    "Paste API keys once — green dot = working. Blank fields never overwrite a saved key; type CLEAR to remove one.",
  ], guide: "/admin/guide#guide-system" }],
  ["/admin", { title: "Admin panel", items: [
    "Tiles are grouped by function; the header jumps to each group.",
    "Full step-by-step handbook: the 📖 Admin guide.",
  ], guide: "/admin/guide" }],
];

export default function PageHelp() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);

  const entry = HELP.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"))?.[1];
  if (!entry) return null;

  return (
    <>
      <button
        aria-label="Help for this page"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", bottom: 18, left: 18, zIndex: 8000,
          width: 40, height: 40, borderRadius: "50%", border: "1px solid var(--border)",
          background: "var(--bg-soft)", color: "inherit", fontWeight: 800, fontSize: "1.05rem",
          cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,.25)",
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Help — ${entry.title}`}
          style={{ position: "fixed", inset: 0, zIndex: 8500, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-end", justifyContent: "flex-start", padding: 16 }}
          onClick={() => setOpen(false)}
        >
          <div className="card" style={{ maxWidth: 420, width: "100%", marginBottom: 52 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <strong>❓ {entry.title}</strong>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--muted)" }}>×</button>
            </div>
            <ul style={{ margin: "10px 0 0 16px", display: "grid", gap: 6, fontSize: ".88rem" }}>
              {entry.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
            {entry.guide && (
              <p style={{ margin: "12px 0 0" }}>
                <a className="btn small secondary" href={entry.guide}>📖 Full guide →</a>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
