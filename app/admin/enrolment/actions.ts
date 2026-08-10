"use server";
import { formatDate } from "@/lib/dates";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str, num } from "../_lib/util";
import { loadTemplate, renderTemplate } from "@/lib/emailTemplates";
import { notifyByEmail, emailShell } from "@/lib/notify";
import { assertArea } from "@/lib/adminAccess";

// A granted subscription must also appear on the student's "My courses" shelf,
// or they can't see what they were given (service client — shelf RLS is
// own-rows-only). subjectId null = whole-course grant → shelve every subject.
async function addToShelf(studentIds: string[], courseId: string, subjectId: string | null) {
  if (!studentIds.length) return;
  const svc = createServiceClient();
  let subjectIds: string[] = subjectId ? [subjectId] : [];
  if (!subjectId) {
    const { data } = await svc.from("subjects").select("id").eq("course_id", courseId);
    subjectIds = (data ?? []).map((s) => s.id as string);
  }
  const [{ data: haveC }, { data: haveS }] = await Promise.all([
    svc.from("my_courses").select("student_id").eq("course_id", courseId).in("student_id", studentIds),
    subjectIds.length
      ? svc.from("my_subjects").select("student_id, subject_id").in("subject_id", subjectIds).in("student_id", studentIds)
      : Promise.resolve({ data: [] as { student_id: string; subject_id: string }[] }),
  ]);
  const hasCourse = new Set((haveC ?? []).map((r) => r.student_id as string));
  const hasSubject = new Set((haveS ?? []).map((r) => `${r.student_id}:${r.subject_id}`));
  const newCourses = studentIds.filter((id) => !hasCourse.has(id)).map((id) => ({ student_id: id, course_id: courseId }));
  const newSubjects = studentIds.flatMap((id) =>
    subjectIds.filter((sid) => !hasSubject.has(`${id}:${sid}`)).map((sid) => ({ student_id: id, subject_id: sid })),
  );
  if (newCourses.length) await svc.from("my_courses").insert(newCourses);
  if (newSubjects.length) await svc.from("my_subjects").insert(newSubjects);
}

const TIERS = ["bronze", "silver", "gold"];

// The granted-access email is drafted in Admin → Enrolment, not here — see
// lib/grantEmail.ts. `expires` is spelled out for the reader rather than left
// as "6 months", because "until 31 January 2027" is what they actually need.
function expiryLabel(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return formatDate(d);
}

function endsAtFromNow(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// Look up the active plan row for a tier.
async function planIdForTier(
  supabase: ReturnType<typeof createClient>,
  tier: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("plans")
    .select("id")
    .eq("tier", tier)
    .eq("is_active", true)
    .order("rank")
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function grantSubscription(formData: FormData) {
  await assertArea(null);
  const email = str(formData.get("email")).toLowerCase();
  const courseId = str(formData.get("course_id"));
  const subjectRaw = str(formData.get("subject_id"));
  const subjectId = subjectRaw && subjectRaw !== "all" ? subjectRaw : null;
  const tier = str(formData.get("tier"));
  const months = num(formData.get("months"), 1);
  if (!email || !courseId || !subjectRaw || !TIERS.includes(tier)) {
    redirect("/admin/enrolment?error=missing");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) redirect(`/admin/enrolment?missing=${encodeURIComponent(email)}`);

  const planId = await planIdForTier(supabase, tier);
  if (!planId) redirect("/admin/enrolment?error=noplan");

  // A double-click used to grant the same thing several times — one student
  // ended up with four identical subscriptions eleven seconds apart. An active
  // subscription for this exact course/subject already covers them, so say so
  // instead of stacking another one on top.
  const dupeQuery = supabase
    .from("subscriptions")
    .select("id, ends_at")
    .eq("student_id", profile.id)
    .eq("course_id", courseId)
    .eq("status", "active");
  const { data: existing } = subjectId
    ? await dupeQuery.eq("subject_id", subjectId).maybeSingle()
    : await dupeQuery.is("subject_id", null).maybeSingle();
  if (existing) {
    const until = existing.ends_at
      ? formatDate(existing.ends_at as string)
      : "";
    redirect(`/admin/enrolment?dupe=${encodeURIComponent(profile.email ?? email)}&until=${encodeURIComponent(until)}`);
  }

  await supabase.from("subscriptions").insert({
    student_id: profile.id,
    course_id: courseId,
    subject_id: subjectId,
    plan_id: planId,
    channel: "admin_grant",
    ends_at: endsAtFromNow(months),
    status: "active",
    auto_renew: false,
    granted_by_admin_id: user?.id ?? null,
  });
  await addToShelf([profile.id], courseId, subjectId);

  const { data: course } = await supabase.from("courses").select("title").eq("id", courseId).maybeSingle();
  const msg = renderTemplate(await loadTemplate("access_granted"), {
    name: profile.full_name || "there",
    course: course?.title ?? "your course",
    tier,
    months,
    expires: expiryLabel(months),
  });
  await notifyByEmail({
    studentId: profile.id,
    email: profile.email,
    subject: msg.subject,
    html: msg.html,
    template: "enrolment_granted",
    payload: { courseId, tier, months },
  });

  revalidatePath("/admin/enrolment");
  // Carry the details back so the confirmation names who got what, rather than
  // a bare tick the admin has to take on trust.
  const q = new URLSearchParams({
    granted: profile.email ?? email,
    tier,
    months: String(months),
    course: course?.title ?? "",
  });
  redirect(`/admin/enrolment?${q.toString()}`);
}

export async function bulkGrant(formData: FormData) {
  await assertArea(null);
  const raw = str(formData.get("emails"));
  const courseId = str(formData.get("course_id"));
  const subjectRaw = str(formData.get("subject_id"));
  const subjectId = subjectRaw && subjectRaw !== "all" ? subjectRaw : null;
  const tier = str(formData.get("tier"));
  const months = num(formData.get("months"), 1);
  const emails = Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  );
  if (!emails.length || !courseId || !subjectRaw || !TIERS.includes(tier)) {
    redirect("/admin/enrolment?error=missing");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const planId = await planIdForTier(supabase, tier);
  if (!planId) redirect("/admin/enrolment?error=noplan");

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("email", emails);

  const found = profiles ?? [];
  const foundEmails = new Set(found.map((p) => (p.email ?? "").toLowerCase()));
  const missing = emails.filter((e) => !foundEmails.has(e));

  if (found.length) {
    const ends = endsAtFromNow(months);
    await supabase.from("subscriptions").insert(
      found.map((p) => ({
        student_id: p.id,
        course_id: courseId,
        subject_id: subjectId,
        plan_id: planId,
        channel: "admin_grant",
        ends_at: ends,
        status: "active",
        auto_renew: false,
        granted_by_admin_id: user?.id ?? null,
      })),
    );
    await addToShelf(found.map((p) => p.id), courseId, subjectId);

    const { data: course } = await supabase.from("courses").select("title").eq("id", courseId).maybeSingle();
    const title = course?.title ?? "your course";
    const template = await loadTemplate("access_granted");
    const expires = expiryLabel(months);
    await Promise.all(
      found.map((p) => {
        const msg = renderTemplate(template, { name: p.full_name || "there", course: title, tier, months, expires });
        return notifyByEmail({
          studentId: p.id,
          email: p.email,
          subject: msg.subject,
          html: msg.html,
          template: "enrolment_granted",
          payload: { courseId, tier, months },
        });
      }),
    );
  }

  revalidatePath("/admin/enrolment");
  const params = new URLSearchParams({ granted: String(found.length) });
  if (missing.length) params.set("missing", missing.join(","));
  redirect(`/admin/enrolment?${params.toString()}`);
}

export async function revokeSubscription(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("subscriptions").update({ status: "cancelled", auto_renew: false }).eq("id", id);
  revalidatePath("/admin/enrolment");
}

// Block a subscription — refund taken back, policy breach, misconduct. Access
// checks require status = 'active', so the student is locked out the moment
// this saves. Reversible: the reason and time are kept so a mistake can be
// undone and a genuine block can be explained later.
export async function blockSubscription(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const reason = str(formData.get("reason")).trim().slice(0, 300);
  if (!id) return;
  await createServiceClient().from("subscriptions").update({
    status: "blocked",
    auto_renew: false,
    blocked_at: new Date().toISOString(),
    blocked_reason: reason || null,
  }).eq("id", id);
  revalidatePath("/admin/enrolment");
  redirect("/admin/enrolment?blocked=1");
}

export async function restoreSubscription(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("subscriptions").update({
    status: "active",
    blocked_at: null,
    blocked_reason: null,
  }).eq("id", id);
  revalidatePath("/admin/enrolment");
  redirect("/admin/enrolment?restored=1");
}

export async function extendSubscription(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const months = num(formData.get("months"), 1);
  const supabase = createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("ends_at")
    .eq("id", id)
    .maybeSingle();
  const now = new Date();
  const base = sub?.ends_at && new Date(sub.ends_at) > now ? new Date(sub.ends_at) : now;
  base.setMonth(base.getMonth() + months);
  await supabase
    .from("subscriptions")
    .update({ ends_at: base.toISOString(), status: "active" })
    .eq("id", id);
  revalidatePath("/admin/enrolment");
}

// Save the wording of the granted-access email. Blank fields fall back to the
// built-in draft, so clearing a box restores the default rather than sending
// an empty email.

// Past students in bulk, ANY size: upload the Excel template (or paste), rows
// queue, and a cron drips the emails slowly so the batch never looks like spam.
export async function queuePastStudents(formData: FormData) {
  await assertArea(null);
  const courseId = str(formData.get("course_id"));
  const subjectId = str(formData.get("subject_id")) || null;
  const tier = TIERS.includes(str(formData.get("tier"))) ? str(formData.get("tier")) : "gold";
  const months = Math.min(36, Math.max(1, num(formData.get("months")) || 3));

  // Two sources, merged: whatever was pasted, plus the rows SpreadsheetPicker
  // read from the uploaded template in the browser. The file itself never
  // reaches the server — uploading it hit the platform's ~4.5 MB request cap
  // and big spreadsheets failed outright, while the extracted lines are only
  // a few KB however large the workbook.
  const lines = [
    ...str(formData.get("bulk")).split(/\r?\n/),
    ...str(formData.get("bulk_rows")).split(/\r?\n/),
  ];

  if (!courseId || !lines.some((l) => l.includes("@"))) redirect("/admin/enrolment?error=queueinput");

  const { queueGrants } = await import("@/lib/grantQueue");
  const r = await queueGrants(lines, courseId, subjectId, tier, months);
  revalidatePath("/admin/enrolment");
  const q = new URLSearchParams({ queued: String(r.added) });
  if (r.alreadyQueued) q.set("requeued", String(r.alreadyQueued));
  if (r.badLines) q.set("badlines", String(r.badLines));
  redirect(`/admin/enrolment?${q.toString()}`);
}
