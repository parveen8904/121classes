import { createClient } from "@/lib/supabase/server";

// ---- Staff roles & per-area permissions -------------------------------------
// admin    = super admin: everything, always (and grants rights to others).
// operator = staff member: only the admin areas ticked in profiles.permissions.
// faculty  = teacher: same permission mechanics as operator.
// student  = no admin access.
//
// Each grantable AREA maps to one or more /admin URL prefixes (for page gating)
// and is checked in that area's server actions via requireArea().

export type AdminArea = { key: string; label: string; prefixes: string[] };

export const ADMIN_AREAS: AdminArea[] = [
  { key: "announcements", label: "📣 Announcements & broadcasts", prefixes: ["/admin/announcements", "/admin/notifications", "/admin/amendments"] },
  { key: "inbox", label: "📥 Inbox & student doubts", prefixes: ["/admin/inbox"] },
  { key: "tickets", label: "🎫 Support tickets", prefixes: ["/admin/tickets"] },
  { key: "articles", label: "📝 Articles & SEO", prefixes: ["/admin/articles"] },
  { key: "moderation", label: "🛡️ Group chat moderation", prefixes: ["/admin/discussion"] },
  { key: "live", label: "📡 Live classes", prefixes: ["/admin/live"] },
  { key: "results", label: "🏆 Results", prefixes: ["/admin/results"] },
  { key: "store", label: "📦 Books & orders", prefixes: ["/admin/books", "/admin/orders"] },
  { key: "career", label: "🎓 Career & placement", prefixes: ["/admin/content", "/admin/placement"] },
  { key: "planner", label: "🗓️ Study planner settings", prefixes: ["/admin/planner"] },
  { key: "repository", label: "📚 AI repository", prefixes: ["/admin/repository"] },
];

// Everything NOT covered above (integrations, telegram, users, enrolment, plans,
// coupons, combos, courses/content editing, AI usage, costs, site, storage,
// control sheet, reports…) stays SUPER-ADMIN ONLY.

export type Staff = { id: string; role: string; permissions: string[] };

// The signed-in user's staff identity (null if not signed in).
export async function currentStaff(): Promise<Staff | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role, permissions").eq("id", user.id).maybeSingle();
  return { id: user.id, role: (data?.role as string) ?? "student", permissions: ((data?.permissions as string[]) ?? []) };
}

export function isStaffRole(role: string): boolean {
  return role === "admin" || role === "operator" || role === "faculty";
}

// Can this staff member manage the given area? (admin → always)
export function staffCanArea(staff: Staff | null, area: string): boolean {
  if (!staff) return false;
  if (staff.role === "admin") return true;
  if (staff.role === "operator" || staff.role === "faculty") return staff.permissions.includes(area);
  return false;
}

// Guard for server actions: true when the caller may manage `area`.
export async function requireArea(area: string): Promise<boolean> {
  return staffCanArea(await currentStaff(), area);
}

// Which /admin path prefixes this staff member may open (for layout/nav gating).
export function allowedPrefixes(staff: Staff): string[] {
  if (staff.role === "admin") return ["/admin"]; // everything
  return ADMIN_AREAS.filter((a) => staff.permissions.includes(a.key)).flatMap((a) => a.prefixes);
}

export function pathAllowed(path: string, staff: Staff): boolean {
  if (staff.role === "admin") return true;
  if (path === "/admin") return staff.permissions.length > 0; // home shows only their tiles
  if (path === "/admin/guide") return staff.permissions.length > 0; // the how-to guide is for all staff
  return allowedPrefixes(staff).some((p) => path === p || path.startsWith(p + "/"));
}

// Map an /admin href to its area key (for filtering nav links & home tiles).
export function areaForPath(path: string): string | null {
  for (const a of ADMIN_AREAS) {
    if (a.prefixes.some((p) => path === p || path.startsWith(p + "/"))) return a.key;
  }
  return null; // super-admin-only path
}
