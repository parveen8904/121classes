import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Logo from "@/app/components/Logo";
import ThemeToggle from "@/app/components/ThemeToggle";
import SignOutButton from "@/app/dashboard/sign-out";
import PortalMobileMenu from "@/app/components/PortalMobileMenu";
import BackButton from "@/app/components/BackButton";

// Shared header for every signed-in portal page (student + admin).
// Two-colour brand strip on top + an inspirational line + emoji nav.
export default async function PortalHeader() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  let isStaff = false;
  let isSupporter = false;
  let subChip: string | null = null;
  if (user) {
    const { data } = await supabase.from("profiles").select("role, is_supporter").eq("id", user.id).single();
    isAdmin = data?.role === "admin";
    isSupporter = Boolean(data?.is_supporter);
    // Operators & faculty are staff too — without this they had NO Admin
    // button after login and thought their new role "didn't work".
    isStaff = isAdmin || data?.role === "faculty" || data?.role === "operator";

    // Always-visible reminder of what the student's access runs till — so
    // nobody wonders whether (or till when) they are subscribed.
    if (!isStaff) {
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("ends_at, plans(tier)")
        .eq("student_id", user.id)
        .eq("status", "active");
      const now = new Date();
      const active = ((subs ?? []) as unknown as { ends_at: string | null; plans: { tier: string } | null }[])
        .filter((s) => !s.ends_at || new Date(s.ends_at) > now);
      if (active.length) {
        const last = active.reduce<string | null>((m, s) => (!s.ends_at ? m : !m || s.ends_at > m ? s.ends_at : m), null);
        const tiers = new Set(active.map((s) => s.plans?.tier));
        const emoji = tiers.has("gold") ? "🥇" : tiers.has("silver") ? "🥈" : "⭐";
        subChip = `${emoji} Subscribed till ${last ? new Date(last).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "further notice"}`;
      }
    }
  }

  const links = [
    { href: "/dashboard", label: "🏠 Dashboard" },
    { href: "/live", label: "📡 Live" },
    { href: "/planner", label: "🗓️ Planner" },
    { href: "/learn/performance", label: "📊 Performance" },
    { href: "/learn/downloads", label: "📥 Downloads" },
    { href: "/amendments", label: "📜 Amendments" },
    { href: "/career", label: "🎓 Career" },
    // Discuss is staff-only in the header — students use Community/doubts.
    ...(isStaff ? [{ href: "/discuss", label: "💬 Discuss" }] : []),
    { href: "/community", label: "📣 Community" },
    { href: "/inbox", label: "📥 Inbox" },
    // Only a sponsor sees this, and it is their own page — nobody else has one.
    ...(isSupporter ? [{ href: "/supporter", label: "💚 Supporter" }] : []),
    { href: "/dashboard/profile", label: "👤 Profile" },
    ...(isStaff ? [{ href: "/admin", label: "🛠️ Admin" }] : []),
  ];

  return (
    <header className="portal-header">
      <div className="portal-strip" />
      <div className="portal-header-inner">
        <div className="portal-brand">
          <BackButton />
          <Link href="/">
            <Logo />
          </Link>
          <span className="portal-tagline">✨ Small steps daily, big CA dreams 💪</span>
        </div>
        <nav className="portal-nav">
          {links.map((l) => (
            <Link key={l.href} className="portal-link" href={l.href}>
              {l.label}
            </Link>
          ))}
          {subChip && (
            <Link
              href="/dashboard"
              title="Your active subscription — see the dashboard for details"
              style={{
                whiteSpace: "nowrap", fontSize: ".74rem", fontWeight: 700,
                padding: "4px 10px", borderRadius: 999,
                background: "var(--accent)", color: "#fff", textDecoration: "none",
              }}
            >
              {subChip}
            </Link>
          )}
          <ThemeToggle />
          {user && (
            <span className="portal-signout">
              <SignOutButton />
            </span>
          )}
          <PortalMobileMenu links={links} signedIn={!!user} />
        </nav>
      </div>
    </header>
  );
}
