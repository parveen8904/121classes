"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str } from "../admin/_lib/util";

// A student must declare their exam ATTEMPT (and, by picking a course, their
// LEVEL) before adding any course/subject — so all content (amendments, plan,
// tests) is moderated to their needs. If the attempt isn't set, send them to the
// profile page to fill the mandatory fields first.
async function ensureProfileReady(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: prof } = await supabase.from("profiles").select("target_attempt").eq("id", userId).maybeSingle();
  if (!prof?.target_attempt || !String(prof.target_attempt).trim()) {
    // The dashboard wizard asks level → subjects → attempt and fills the
    // profile from the answers — no separate profile-form detour.
    redirect("/dashboard");
  }
}

// Admins organise content across ALL levels — no one-level restriction and no
// attempt requirement for them.
async function isAdminUser(supabase: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return prof?.role === "admin";
}

// A student's personal "My Courses" shelf. These pick rows DON'T grant content
// access (paid plans still gate premium sections) — they organise the student's
// dashboard and decide which subject-wise Telegram groups they may join.

export async function addMyCourse(formData: FormData) {
  const courseId = str(formData.get("course_id"));
  if (!courseId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const admin = await isAdminUser(supabase, user.id);
  if (!admin) {
    await ensureProfileReady(supabase, user.id);
    // One level only: don't add a second, different course/level. To switch level,
    // the student changes it in their Profile (which replaces the shelf).
    const { data: myC } = await supabase.from("my_courses").select("course_id").eq("student_id", user.id);
    const ids = (myC ?? []).map((r) => r.course_id as string);
    if (ids.length > 0 && !ids.includes(courseId)) return;
  }
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
  const admin = await isAdminUser(supabase, user.id);
  if (!admin) {
    await ensureProfileReady(supabase, user.id);

    // Level restriction: a student stays on ONE course/level. If they already have
    // a course on their shelf, they can only add subjects from THAT course — not
    // from a different level (e.g. an Intermediate student can't add a Final subject).
    const { data: myC } = await supabase.from("my_courses").select("course_id").eq("student_id", user.id);
    const myCourseIds = (myC ?? []).map((r) => r.course_id as string);
    if (myCourseIds.length > 0 && courseId && !myCourseIds.includes(courseId)) return;
  }
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
