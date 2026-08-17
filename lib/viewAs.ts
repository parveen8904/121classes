import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// LOOKING AT A STUDENT'S DASHBOARD WITHOUT THEIR PASSWORD.
//
// Support work needs the student's own screen. "It's showing error" is nearly
// impossible to act on from an admin table of rows; the same fault is obvious
// the moment you see what they see. So an admin may open any student's
// dashboard — and nobody ever needs to ask a student for their password, which
// is the practice this replaces.
//
// THREE RULES, and they are what make this safe:
//
//  1. THE COOKIE IS NOT AUTHORITY. It carries only a student id. The logged-in
//     user's role is re-read from the database on EVERY render, and a non-admin
//     holding the cookie gets their own dashboard as though it were not there.
//     This is the mistake that caused the role-escalation hole found in July —
//     trusting something the browser sent.
//
//  2. READ-ONLY, ENFORCED BY NOT RENDERING. Nothing that writes is drawn while
//     viewing: no password form, no Telegram link, no phone verification, no
//     onboarding wizard, no add/remove course. There is no "save" to press by
//     accident, so an admin cannot change a student's account from inside their
//     dashboard.
//
//  3. IT IS RECORDED. Every look writes a row in admin_view_as_log.
//
// The admin's OWN session is never exchanged or impersonated. They stay signed
// in as themselves throughout; only the id used to read the page changes.

export const VIEW_AS_COOKIE = "view_as_student";

export type ViewingAs = {
  /** The student whose dashboard is on screen. */
  studentId: string;
  studentName: string;
  studentEmail: string;
  /** The admin doing the looking — shown in the banner so it is never ambiguous. */
  adminName: string;
};

/**
 * Is an admin currently viewing somebody else's dashboard?
 *
 * Returns null for everyone else, including a signed-in student who somehow has
 * the cookie set. Never throws: a fault here must leave the student's own
 * dashboard working, not break it.
 */
export async function viewingStudent(): Promise<ViewingAs | null> {
  try {
    const jar = await cookies();
    const target = (jar.get(VIEW_AS_COOKIE)?.value ?? "").trim();
    if (!target) return null;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    // Viewing your own dashboard is just your dashboard.
    if (user.id === target) return null;

    // THE CHECK THAT MATTERS. Read the role from the database, not the cookie
    // and not the session's own claims.
    const svc = createServiceClient();
    const { data: me } = await svc
      .from("profiles").select("role, full_name, email").eq("id", user.id).maybeSingle();
    if ((me?.role as string) !== "admin") return null;

    const { data: them } = await svc
      .from("profiles").select("full_name, email").eq("id", target).maybeSingle();
    if (!them) return null;

    // Record the look. Best-effort and deliberately after the permission check,
    // so a refused attempt is not written as though it succeeded. The unique
    // index collapses repeat visits within the hour, so the conflict is
    // expected rather than an error.
    const hour = new Date();
    hour.setMinutes(0, 0, 0);
    await svc.from("admin_view_as_log").upsert({
      admin_id: user.id,
      admin_name: String(me?.full_name ?? me?.email ?? "admin"),
      student_id: target,
      hour_bucket: hour.toISOString(),
    }, { onConflict: "admin_id,student_id,hour_bucket", ignoreDuplicates: true }).then(
      () => undefined,
      () => undefined,
    );

    return {
      studentId: target,
      studentName: String(them.full_name ?? them.email ?? "this student"),
      studentEmail: String(them.email ?? ""),
      adminName: String(me?.full_name ?? me?.email ?? "admin"),
    };
  } catch {
    // Never let this be the reason a student cannot see their own dashboard.
    return null;
  }
}
