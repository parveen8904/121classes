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

  await supabase
    .from("profiles")
    .update({
      full_name: str(formData.get("full_name")) || null,
      phone: nullable(formData.get("phone")),
      target_attempt: nullable(formData.get("target_attempt")),
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
  // makes it the single course on the shelf, and any subjects from a DIFFERENT
  // level are dropped (so the student stays on one level).
  const courseId = str(formData.get("course_id"));
  if (courseId) {
    await supabase.from("my_courses").delete().eq("student_id", user.id);
    await supabase.from("my_courses").insert({ student_id: user.id, course_id: courseId });
    const { data: courseSubs } = await supabase.from("subjects").select("id").eq("course_id", courseId);
    const validIds = (courseSubs ?? []).map((s) => s.id as string);
    const { data: mySubs } = await supabase.from("my_subjects").select("subject_id").eq("student_id", user.id);
    const toRemove = (mySubs ?? []).map((r) => r.subject_id as string).filter((sid) => !validIds.includes(sid));
    if (toRemove.length) {
      await supabase.from("my_subjects").delete().eq("student_id", user.id).in("subject_id", toRemove);
    }
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");
  // Saving closes the profile form and returns to the dashboard with a confirmation.
  redirect("/dashboard?saved=profile");
}
