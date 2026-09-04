import Link from "next/link";
import AdminHero from "@/app/admin/_components/AdminHero";

// THE DESK, BROKEN INTO ROOMS.
//
// His instruction, 2 September 2026: "Make this page simple and clean. Use
// multiple pages with links."
//
// /admin/zoho had grown to 2,813 lines and thirteen collapsible sections on one
// screen: sales, settlements, statements, petty cash, investments, invoices,
// approvals, the vault, tax worksheets, the backlog, search, Rule 115 and the
// build notes. Every one of them loaded on every visit, whichever one you came
// for, and a message from any of them landed in whichever section happened to
// render the banner. Anchors were doing the work that routes should do.
//
// Now each is its own page, so it loads only its own data and can be linked to,
// bookmarked and sent to somebody. This is the frame they share.

export type DeskTab = {
  href: string; label: string; icon: string;
  group: "Approve" | "Work" | "Records";
  count?: number; warn?: boolean;
};

// SETTLEMENTS IS NOT A ROOM ON THIS DESK — removed 4 September 2026 on his
// instruction. Razorpay settlements are a cross-check, not a place work gets
// done, and a tile that is never opened is a tile that hides the ones that are.
//
// Only the door is gone. /admin/zoho/settlements still answers, the 115 rows
// stay (6 of them already posted to Zoho), and settlement still exists as an
// approval kind so anything mid-flight can finish. Nothing creates a NEW one
// unattended either: the scan runs only from the button on that page, never
// from a cron — so with the tile gone the queue simply stops filling.
export const DESK_TABS: DeskTab[] = [
  { href: "/admin/zoho/approvals", label: "Waiting on you", icon: "✋", group: "Approve", warn: true },
  { href: "/admin/zoho/sales", label: "Sales", icon: "📮", group: "Work" },
  { href: "/admin/zoho/statements", label: "Statements", icon: "🏧", group: "Work" },
  { href: "/admin/zoho/petty", label: "Petty cash", icon: "👛", group: "Work" },
  { href: "/admin/zoho/investments", label: "Investments", icon: "📈", group: "Work" },
  { href: "/admin/zoho/invoices", label: "Invoices", icon: "🧾", group: "Work" },
  { href: "/admin/zoho/vault", label: "Vault", icon: "🗄️", group: "Records" },
  { href: "/admin/zoho/tax", label: "Tax", icon: "🧾", group: "Records" },
  { href: "/admin/zoho/backlog", label: "Backlog", icon: "📋", group: "Records" },
  { href: "/admin/zoho/search", label: "Search", icon: "🔎", group: "Records" },
  { href: "/admin/zoho/activity", label: "Zoho activity", icon: "📜", group: "Records" },
  { href: "/admin/zoho/itr", label: "Return builder", icon: "📑", group: "Records" },
  { href: "/admin/zoho/entities", label: "Books & entities", icon: "👪", group: "Records" },
];

/**
 * THE MESSAGE APPEARS WHERE THE WORK WAS DONE.
 *
 * Every action redirects back with ?scan=. On one page that message could only
 * be drawn in one place — which is how "This email ID is already registered"
 * came to appear in the sales section, in green. On its own page there is only
 * one place it can be, and it is the right one.
 */
export function DeskNotice({ message }: { message?: string }) {
  const msg = (message ?? "").trim();
  if (!msg) return null;
  const bad = /already|could not|cannot|failed|no portal login|not found|still holds|⚠️|refused|invalid|blocked/i.test(msg);
  return <div className={bad ? "notice err" : "notice ok"} style={{ marginTop: 12 }}>{bad ? "⚠️" : "✅"} {msg}</div>;
}

/** The frame every room of the desk sits in: where you are, and how to leave. */
export default function DeskShell({
  title, subtitle, badge, current, message, children,
}: {
  title: string; subtitle: string; badge: string;
  current: string; message?: string; children: React.ReactNode;
}) {
  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 980 }}>
      <AdminHero badge={badge} title={title} subtitle={subtitle} back={{ href: "/admin/zoho", label: "The books desk" }} />

      {/* Every other room, one press away — the anchors this replaced could
          only ever move you within one enormous page. */}
      <nav className="card zoho-nav" style={{ marginTop: 12 }}>
        <div className="nav-row" style={{ flexWrap: "wrap", gap: 6 }}>
          {DESK_TABS.filter((t) => t.href !== current).map((t) => (
            <Link key={t.href} className="btn small secondary" href={t.href}>{t.icon} {t.label}</Link>
          ))}
        </div>
      </nav>

      <DeskNotice message={message} />
      {children}
    </section>
  );
}
