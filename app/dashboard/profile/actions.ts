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

  // Course (level) + opted subjects → the My Courses / My Subjects shelf.
  // Picking a course REPLACES the shelf so a student stays on ONE level, and only
  // subjects that belong to that course are kept (level restriction).
  const courseId = str(formData.get("course_id"));
  if (courseId) {
    const subjectIds = formData.getAll("subject_ids").map((v) => String(v)).filter(Boolean);
    await supabase.from("my_courses").delete().eq("student_id", user.id);
    await supabase.from("my_courses").insert({ student_id: user.id, course_id: courseId });
    await supabase.from("my_subjects").delete().eq("student_id", user.id);
    if (subjectIds.length) {
      const { data: validSubs } = await supabase
        .from("subjects")
        .select("id")
        .eq("course_id", courseId)
        .in("id", subjectIds);
      const validIds = (validSubs ?? []).map((s) => s.id as string);
      if (validIds.length) {
        await supabase.from("my_subjects").insert(validIds.map((sid) => ({ student_id: user.id, subject_id: sid })));
      }
    }
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");
  // Saving closes the profile form and returns to the dashboard with a confirmation.
  redirect("/dashboard?saved=profile");
}
