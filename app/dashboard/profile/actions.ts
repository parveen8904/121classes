"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../../admin/_lib/util";

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
      pincode: nullable(formData.get("pincode")),
      gstin: nullable(formData.get("gstin")),
      business_name: nullable(formData.get("business_name")),
    })
    .eq("id", user.id);

  // Course (level) only — subjects are chosen on the dashboard. Picking a course
  // makes it the single ACTIVE course/level. We DON'T delete the subjects from
  // other levels: each level's subject choices are remembered, so if the student
  // ever switches back to a level, its subjects are restored automatically.
  const courseId = str(formData.get("course_id"));
  if (courseId) {
    await supabase.from("my_courses").delete().eq("student_id", user.id);
    await supabase.from("my_courses").insert({ student_id: user.id, course_id: courseId });
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");

  // Attempt AND course/level are mandatory. If either is still missing, keep what
  // was entered but bounce back to the profile asking for the missing ones.
  const { data: myC } = await supabase.from("my_courses").select("course_id").eq("student_id", user.id);
  const hasCourse = courseId || (myC ?? []).length > 0;
  if (!targetAttempt || !String(targetAttempt).trim() || !hasCourse) {
    redirect("/dashboard/profile?need=fields");
  }

  // Saving closes the profile form and returns to the dashboard with a confirmation.
  redirect("/dashboard?saved=profile");
}
