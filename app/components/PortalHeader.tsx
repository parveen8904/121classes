import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Logo from "@/app/components/Logo";
import ThemeToggle from "@/app/components/ThemeToggle";
import SignOutButton from "@/app/dashboard/sign-out";
import PortalMobileMenu from "@/app/components/PortalMobileMenu";

// Shared header for every signed-in portal page (student + admin).
// Two-colour brand strip on top + an inspirational line + emoji nav.
export default async function PortalHeader() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    isAdmin = data?.role === "admin";
  }

  const links = [
    { href: "/dashboard", label: "🏠 Dashboard" },
    { href: "/live", label: "📡 Live" },
    { href: "/learn/downloads", label: "📥 Downloads" },
    { href: "/learn/performance", label: "📊 Performance" },
    { href: "/inbox", label: "📨 My Questions" },
    { href: "/community", label: "💬 Community" },
    { href: "/books", label: "📦 Books" },
    { href: "/dashboard/profile", label: "👤 Profile" },
    ...(isAdmin ? [{ href: "/admin", label: "🛠️ Admin" }] : []),
  ];

  return (
    <header className="portal-header">
      <div className="portal-strip" />
      <div className="portal-header-inner">
        <div className="portal-brand">
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
