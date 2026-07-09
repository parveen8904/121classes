"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str } from "../admin/_lib/util";

// One-tap onboarding from the dashboard wizard: the student ANSWERS questions
// (level → subjects → attempt) and we write the profile/shelf from the answers
// — instead of sending them to fill a profile form first and come back.
export async function completeOnboarding(formData: FormData) {
  const courseId = str(formData.get("course_id"));
  const attempt = str(formData.get("target_attempt"));
  const subjectIds = formData.getAll("subj").map(String).filter(Boolean);
  if (!courseId) return;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // The chosen attempt lands in the profile (that's the "fit it in the profile" part).
  if (attempt) await supabase.from("profiles").update({ target_attempt: attempt }).eq("id", user.id);

  // Students study ONE level: the chosen course replaces anything else on the shelf.
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") {
    await supabase.from("my_courses").delete().eq("student_id", user.id).neq("course_id", courseId);
  }
  await supabase.from("my_courses").upsert(
    { student_id: user.id, course_id: courseId },
    { onConflict: "student_id,course_id" },
  );

  for (const sid of subjectIds) {
    await supabase.from("my_subjects").upsert(
      { student_id: user.id, subject_id: sid },
      { onConflict: "student_id,subject_id" },
    );
  }

  revalidatePath("/dashboard");
  revalidatePath(`/learn/${courseId}`);
}
