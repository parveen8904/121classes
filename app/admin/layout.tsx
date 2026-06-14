import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PortalHeader from "@/app/components/PortalHeader";
import PortalFooter from "@/app/components/PortalFooter";

// All /admin/* pages are request-time rendered (they read the auth cookie).
export const dynamic = "force-dynamic";

const ADMIN_LINKS: [string, string][] = [
  ["📘 Courses", "/admin/courses"],
  ["👥 Users", "/admin/users"],
  ["👩‍🏫 Faculty", "/admin/faculty"],
  ["📣 Announcements", "/admin/announcements"],
  ["📥 Inbox", "/admin/inbox"],
  ["🔌 Integrations", "/admin/integrations"],
  ["🎟️ Enrolment", "/admin/enrolment"],
  ["💳 Plans", "/admin/plans"],
  ["📦 Books", "/admin/books"],
  ["🚚 Orders", "/admin/orders"],
  ["📡 Live", "/admin/live"],
  ["🏆 Results", "/admin/results"],
  ["🏷️ Coupons", "/admin/coupons"],
  ["🎁 Combos", "/admin/combos"],
  ["📊 Reports", "/admin/reports"],
  ["🖼️ Site images", "/admin/site"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return (
      <>
        <PortalHeader />
        <main className="narrow" style={{ paddingTop: 60 }}>
          <div className="card">
            <h1 style={{ fontSize: "1.3rem", marginBottom: 8 }}>🔒 Admins only</h1>
            <p className="muted">
              Your account isn&apos;t an admin. Set <code>role = &apos;admin&apos;</code> on your row
              in the <code>profiles</code> table (Supabase &rarr; Table editor) to access this area.
            </p>
            <p style={{ marginTop: 16 }}>
              <Link className="btn secondary" href="/dashboard">
                ← Back to dashboard
              </Link>
            </p>
          </div>
        </main>
        <PortalFooter />
      </>
    );
  }

  return (
    <>
      <PortalHeader />
      <nav className="portal-subnav">
        <div className="portal-subnav-inner">
          {ADMIN_LINKS.map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </div>
      </nav>
      <main>{children}</main>
      <PortalFooter />
    </>
  );
}
