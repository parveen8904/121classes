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
  // The panel moved: doubts now open through the /admin/messages hub, with the
  // WhatsApp desk and the doubt log inside it. The grant kept authorising only
  // the OLD path, so a staff member given "Inbox & student doubts" clicked the
  // Messages tile and was refused — rights he had been given "did not reflect".
  { key: "inbox", label: "💬 Student doubts & WhatsApp", prefixes: ["/admin/inbox", "/admin/messages", "/admin/whatsapp", "/admin/doubt-log"] },
  { key: "tasks", label: "✅ Office tasks", prefixes: ["/admin/tasks"] },
  { key: "tickets", label: "🎫 Support tickets", prefixes: ["/admin/tickets"] },
  { key: "articles", label: "📝 Articles & SEO", prefixes: ["/admin/articles"] },
  { key: "reengage", label: "🔁 Re-engagement emails", prefixes: ["/admin/reengage"] },
  { key: "moderation", label: "🛡️ Group chat moderation", prefixes: ["/admin/discussion"] },
  { key: "live", label: "📡 Live classes", prefixes: ["/admin/live"] },
  { key: "results", label: "🏆 Results", prefixes: ["/admin/results"] },
  { key: "store", label: "💳 Sales, orders & books", prefixes: ["/admin/books", "/admin/orders", "/admin/supporters", "/admin/accounts"] },
  { key: "warehouse", label: "🏭 Warehouse & shipping", prefixes: ["/admin/warehouse"] },
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

/**
 * The page a staff member should land on.
 *
 * A warehouse packer is an operator whose only right is the warehouse. Sending
 * them to /dashboard put them on the STUDENT home — a shelf of subjects they do
 * not have, with their actual work nowhere in sight. Somebody granted exactly
 * one area is taken straight to it; anyone with several gets the admin home to
 * choose from.
 */
export function staffHome(staff: Staff | null): string | null {
  if (!staff) return null;
  if (staff.role === "admin") return "/admin";
  if (staff.role !== "operator" && staff.role !== "faculty") return null;
  const areas = ADMIN_AREAS.filter((a) => staff.permissions.includes(a.key));
  if (areas.length === 0) return null;
  return areas.length === 1 ? areas[0].prefixes[0] : "/admin";
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

// The same check, but it STOPS the action instead of returning a boolean a
// caller can forget to read.
//
// Every "use server" export is a public POST endpoint — the admin layout only
// guards the PAGE, not the actions the page uses. An action that skipped this
// and used the service client was a way in for anyone who knew its id, so this
// belongs at the top of every one of them. `area` null = super-admins only
// (integrations, users, plans, and everything else not delegable to staff).
export async function assertArea(area: string | null): Promise<void> {
  const staff = await currentStaff();
  const ok = area ? staffCanArea(staff, area) : staff?.role === "admin";
  if (!ok) throw new Error("Not authorised — this action needs admin rights.");
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
