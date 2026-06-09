import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Logo from "@/app/components/Logo";
import ThemeToggle from "@/app/components/ThemeToggle";
import SignOutButton from "@/app/dashboard/sign-out";

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
          <Link href="/dashboard">🏠 Dashboard</Link>
          <Link href="/books">📦 Books</Link>
          <Link href="/dashboard/profile">👤 Profile</Link>
          {isAdmin && <Link href="/admin">🛠️ Admin</Link>}
          <ThemeToggle />
          {user && <SignOutButton />}
        </nav>
      </div>
    </header>
  );
}
