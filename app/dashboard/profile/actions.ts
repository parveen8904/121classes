"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../../admin/_lib/util";
import { safeInternalPath } from "@/lib/safeNext";

export async function updateProfile(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const targetAttempt = nullable(formData.get("target_attempt"));

  await supabase
    .from("profiles")
    .update({
      full_name: str(formData.get("full_name")) || null,
      phone: nullable(formData.get("phone")),
      target_attempt: targetAttempt,
      address_line1: nullable(formData.get("address_line1")),
      address_line2: nullable(formData.get("address_line2")),
      city: nullable(formData.get("city")),
      state: nullable(formData.get("state")),
      // India or elsewhere — the form now asks, so a province from abroad is
      // no longer silently filed as if it were an Indian state.
      country: nullable(formData.get("country")) ?? "India",
      pincode: nullable(formData.get("pincode")),
      gstin: nullable(formData.get("gstin")),
      business_name: nullable(formData.get("business_name")),
      // Exactly as the GST register spells it, when a verification has run.
      trade_name: nullable(formData.get("trade_name")),
    })
    .eq("id", user.id);

  // Course (level) only — subjects are chosen on the dashboard. Picking a course
  // makes it the single ACTIVE course/level. We DON'T delete the subjects from
  // other levels: each level's subject choices are remembered, so if the student
  // ever switches back to a level, its subjects are restored automatically.
  const courseId = str(formData.get("course_id"));
  if (courseId) {
    // Keep any course the student holds an active subscription for — switching
    // level must never hide paid or granted access.
    const { data: subbed } = await supabase
      .from("subscriptions").select("course_id").eq("student_id", user.id)
      .eq("status", "active").or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`);
    const keep = new Set([courseId, ...(subbed ?? []).map((s) => s.course_id as string)]);
    const { data: mine } = await supabase.from("my_courses").select("course_id").eq("student_id", user.id);
    const drop = (mine ?? []).map((r) => r.course_id as string).filter((id) => !keep.has(id));
    if (drop.length) await supabase.from("my_courses").delete().eq("student_id", user.id).in("course_id", drop);
    await supabase.from("my_courses").upsert({ student_id: user.id, course_id: courseId }, { onConflict: "student_id,course_id" });
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");

  // Attempt AND course/level are mandatory. If either is still missing, keep what
  // was entered but bounce back to the profile asking for the missing ones.
  // WHERE THEY WERE BEFORE WE INTERRUPTED THEM.
  //
  // A student who pressed Pay and was sent here for an address used to be
  // dropped on the dashboard afterwards, with no way back to the plan except to
  // find it again — and if their attempt was also missing they were bounced
  // back to this same form a second time, losing the trail entirely.
  //
  // Only our own paths: an address that arrives in a query string is not a
  // place to send somebody after they have signed in.
  const safeBack = safeInternalPath(formData.get("next"));

  const { data: myC } = await supabase.from("my_courses").select("course_id").eq("student_id", user.id);
  const hasCourse = courseId || (myC ?? []).length > 0;
  if (!targetAttempt || !String(targetAttempt).trim() || !hasCourse) {
    redirect(`/dashboard/profile?need=fields${safeBack ? `&next=${encodeURIComponent(safeBack)}` : ""}`);
  }

  // Straight back to the plan they were buying, if that is where they came
  // from; otherwise the dashboard with a confirmation.
  redirect(safeBack || "/dashboard?saved=profile");
}
