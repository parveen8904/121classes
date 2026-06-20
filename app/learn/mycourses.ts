"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str } from "../admin/_lib/util";

// A student's personal "My Courses" shelf. These pick rows DON'T grant content
// access (paid plans still gate premium sections) — they organise the student's
// dashboard and decide which subject-wise Telegram groups they may join.

export async function addMyCourse(formData: FormData) {
  const courseId = str(formData.get("course_id"));
  if (!courseId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("my_courses").upsert(
    { student_id: user.id, course_id: courseId },
    { onConflict: "student_id,course_id" },
  );
  revalidatePath("/dashboard");
}

export async function removeMyCourse(formData: FormData) {
  const courseId = str(formData.get("course_id"));
  if (!courseId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("my_courses").delete().eq("student_id", user.id).eq("course_id", courseId);
  // Also drop any of this course's subjects from the shelf.
  const { data: subs } = await supabase.from("subjects").select("id").eq("course_id", courseId);
  const ids = (subs ?? []).map((s) => s.id);
  if (ids.length) await supabase.from("my_subjects").delete().eq("student_id", user.id).in("subject_id", ids);
  revalidatePath("/dashboard");
  revalidatePath(`/learn/${courseId}`);
}

export async function addMySubject(formData: FormData) {
  const subjectId = str(formData.get("subject_id"));
  const courseId = str(formData.get("course_id"));
  if (!subjectId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("my_subjects").upsert(
    { student_id: user.id, subject_id: subjectId },
    { onConflict: "student_id,subject_id" },
  );
  // Adding a subject implicitly adds its course to the shelf.
  if (courseId) {
    await supabase.from("my_courses").upsert(
      { student_id: user.id, course_id: courseId },
      { onConflict: "student_id,course_id" },
    );
    revalidatePath(`/learn/${courseId}`);
  }
  revalidatePath("/dashboard");
}

export async function removeMySubject(formData: FormData) {
  const subjectId = str(formData.get("subject_id"));
  const courseId = str(formData.get("course_id"));
  if (!subjectId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("my_subjects").delete().eq("student_id", user.id).eq("subject_id", subjectId);
  if (courseId) revalidatePath(`/learn/${courseId}`);
  revalidatePath("/dashboard");
}
