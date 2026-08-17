"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { VIEW_AS_COOKIE } from "@/lib/viewAs";

// Start and stop looking at a student's dashboard. See lib/viewAs.ts for why
// this is safe; the short version is that the cookie set here is only ever a
// hint, and the admin check is done again on every render.

/** Open a student's dashboard. Admin only. */
export async function startViewAs(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "").trim();
  if (!studentId) return;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Guarded here as well as on render. A cookie that was never allowed to be
  // set is one fewer thing to reason about later.
  const svc = createServiceClient();
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if ((me?.role as string) !== "admin") redirect("/dashboard");

  const jar = await cookies();
  jar.set(VIEW_AS_COOKIE, studentId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // DELIBERATELY SHORT. Nobody should still be looking through a student's
    // dashboard tomorrow because they forgot to close a tab — and a stale
    // cookie is how an admin ends up confused about whose data is on screen.
    maxAge: 60 * 60,
  });

  redirect("/dashboard");
}

/** Go back to your own dashboard. Available to anyone, so it can never trap. */
export async function stopViewAs() {
  const jar = await cookies();
  jar.delete(VIEW_AS_COOKIE);
  redirect("/dashboard");
}
