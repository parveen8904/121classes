import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// All /admin/* pages are request-time rendered (they read the auth cookie).
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return (
      <main className="narrow" style={{ paddingTop: 80 }}>
        <div className="card">
          <h1 style={{ fontSize: "1.3rem", marginBottom: 8 }}>Admins only</h1>
          <p className="muted">
            Your account isn&apos;t an admin. Set <code>role = &apos;admin&apos;</code> on your row
            in the <code>profiles</code> table (Supabase &rarr; Table editor) to access this area.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link className="btn secondary" href="/dashboard">
              Back to dashboard
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <div>
      <header className="topbar">
        <Link className="logo" href="/admin">
          1:1 <span>Admin</span>
        </Link>
        <nav style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="muted" href="/admin/courses">
            Courses
          </Link>
          <Link className="muted" href="/admin/faculty">
            Faculty
          </Link>
          <Link className="muted" href="/admin/announcements">
            Announcements
          </Link>
          <Link className="muted" href="/dashboard">
            Student view
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
