"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str } from "../admin/_lib/util";

// A sponsor just gives their phone, then goes to gift a subscription. We mark
// the account as a sponsor so the mandatory-setup gate is satisfied.
export async function completeSponsorSetup(formData: FormData) {
  const phone = str(formData.get("phone")).trim();
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("profiles").update({ account_type: "sponsor", phone: phone || null }).eq("id", user.id);
  revalidatePath("/dashboard");
  redirect("/gift");
}

// One-tap onboarding from the dashboard wizard: the student ANSWERS questions
// (level → subjects → attempt) and we write the profile/shelf from the answers
// — instead of sending them to fill a profile form first and come back.
export async function completeOnboarding(formData: FormData) {
  const courseId = str(formData.get("course_id"));
  const attempt = str(formData.get("target_attempt"));
  const phone = str(formData.get("phone")).trim();
  const subjectIds = formData.getAll("subj").map(String).filter(Boolean);
  // Mandatory: level, at least one subject, and a phone number.
  if (!courseId || subjectIds.length === 0 || phone.replace(/\D/g, "").length < 10) return;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // The chosen attempt + phone land in the profile (mandatory fields).
  await supabase.from("profiles").update({
    account_type: "student",
    phone,
    ...(attempt ? { target_attempt: attempt } : {}),
  }).eq("id", user.id);
  // Marketing attribution — asked once, optional.
  const heardFrom = str(formData.get("heard_from"));
  if (heardFrom) await supabase.from("profiles").update({ heard_from: heardFrom }).eq("id", user.id);

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
