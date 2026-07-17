import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole, pathAllowed, areaForPath, type Staff } from "@/lib/adminAccess";
import { ADMIN_GROUPS } from "@/lib/adminNav";
import PortalHeader from "@/app/components/PortalHeader";
import PortalFooter from "@/app/components/PortalFooter";

// All /admin/* pages are request-time rendered (they read the auth cookie).
export const dynamic = "force-dynamic";

// The header shows the same GROUPS as the dashboard (one source of truth in
// lib/adminNav.ts) — clicking a group jumps to that section of the dashboard.
// No more headers-without-tiles or tiles-without-headers.

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, permissions")
    .eq("id", user.id)
    .single();
  const role = (profile?.role as string) ?? "student";
  const staff: Staff = { id: user.id, role, permissions: ((profile?.permissions as string[]) ?? []) };

  // MFA is no longer enforced (founder's call 2026-07-14: more friction than
  // benefit — the password-manager confusion outweighed it). The /auth/mfa
  // pages still exist for anyone who wants to enroll voluntarily.

  const isStaffMember = isStaffRole(role) && (role === "admin" || staff.permissions.length > 0);
  if (!isStaffMember) {
    return (
      <>
        <PortalHeader />
        <main className="narrow" style={{ paddingTop: 60 }}>
          <div className="card">
            <h1 style={{ fontSize: "1.3rem", marginBottom: 8 }}>🔒 Staff only</h1>
            <p className="muted">
              Your account doesn&apos;t have admin-panel access. Ask the administrator to grant you a
              role (operator / faculty) and the rights you need.
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

  // Operators/faculty may only open the areas they've been granted.
  const path = (await headers()).get("x-pathname") || "/admin";
  if (!pathAllowed(path, staff)) {
    return (
      <>
        <PortalHeader />
        <main className="narrow" style={{ paddingTop: 60 }}>
          <div className="card">
            <h1 style={{ fontSize: "1.3rem", marginBottom: 8 }}>🔒 No access to this section</h1>
            <p className="muted">
              Your account ({role}) doesn&apos;t have rights for this area. The administrator can grant
              it from Admin → Users.
            </p>
            <p style={{ marginTop: 16 }}>
              <Link className="btn secondary" href="/admin">← My admin areas</Link>
            </p>
          </div>
        </main>
        <PortalFooter />
      </>
    );
  }

  // Staff see only the groups containing at least one area they can open.
  const canPath = (href: string) => {
    if (role === "admin") return true;
    const area = areaForPath(href);
    return area !== null && staff.permissions.includes(area);
  };
  const visibleLinks: [string, string][] = [
    ["🏠 Dashboard", "/admin"],
    ...ADMIN_GROUPS
      .filter((g) => g.panels.some((p) => canPath(p.href)))
      .map((g) => [`${g.icon} ${g.title}`, `/admin#${g.id}`] as [string, string]),
  ];

  return (
    <>
      <PortalHeader />
      <nav className="portal-subnav">
        <div className="portal-subnav-inner">
          {visibleLinks.map(([label, href]) => (
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
