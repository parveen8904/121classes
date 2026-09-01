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
import { addMonths, extendedEndsAt, endsAtFromNow } from "@/lib/subscriptionDates";

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
  return formatDate(addMonths(new Date(), months));
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
  await assertArea("enrolment");
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
  //
  // maybeSingle() USED TO DEFEAT THIS ENTIRELY. It errors when the query
  // matches more than one row and hands back data: null — so the moment a
  // student had two stacked subscriptions the guard read "none" and cheerfully
  // added a third. Yashasvi Chaudhary reached three that way, and the dashboard
  // then showed her the latest of them rather than the longest. Take the
  // longest-running row instead, which is the one an extension should land on.
  const dupeQuery = supabase
    .from("subscriptions")
    .select("id, ends_at")
    .eq("student_id", profile.id)
    .eq("course_id", courseId)
    .eq("status", "active")
    .order("ends_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const { data: existingRows } = subjectId
    ? await dupeQuery.eq("subject_id", subjectId)
    : await dupeQuery.is("subject_id", null);
  const existing = (existingRows ?? [])[0];
  if (existing) {
    const until = existing.ends_at
      ? formatDate(existing.ends_at as string)
      : "";
    // Carry the row id back so the page can offer Extend on the spot. Telling
    // the admin to "use Extend on the row below" was useless when the student
    // was not among the hundred most recent subscriptions.
    const q = new URLSearchParams({
      dupe: profile.email ?? email,
      until,
      dupe_id: existing.id as string,
      dupe_name: profile.full_name || "",
    });
    redirect(`/admin/enrolment?${q.toString()}`);
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
  await assertArea("enrolment");
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

  let extended = 0;
  if (found.length) {
    // BULK USED TO STACK, NEVER EXTEND.
    //
    // Every email got a brand-new subscription running from TODAY, whatever
    // they already held. A student with access to 25 November given twelve
    // months in bulk ended up with two overlapping rows, and the dashboard
    // showed whichever the access check happened to pick — which is how a
    // 24-month FR student came to see an expiry eleven months early.
    //
    // So: an active row for this exact course and subject is EXTENDED from its
    // own expiry; only a student with none gets a new one.
    const existingQuery = supabase
      .from("subscriptions")
      .select("id, student_id, ends_at")
      .in("student_id", found.map((p) => p.id))
      .eq("course_id", courseId)
      .eq("status", "active");
    const { data: existingRows } = subjectId
      ? await existingQuery.eq("subject_id", subjectId)
      : await existingQuery.is("subject_id", null);

    // Longest-running row per student — the one an extension should land on.
    const longest = new Map<string, { id: string; ends_at: string | null }>();
    for (const row of existingRows ?? []) {
      const cur = longest.get(row.student_id as string);
      const a = row.ends_at as string | null;
      if (!cur || (a && (!cur.ends_at || new Date(a) > new Date(cur.ends_at)))) {
        longest.set(row.student_id as string, { id: row.id as string, ends_at: a });
      }
    }

    await Promise.all(
      [...longest.values()].map((row) =>
        supabase.from("subscriptions")
          .update({ ends_at: extendedEndsAt(row.ends_at, months), status: "active" })
          .eq("id", row.id),
      ),
    );
    extended = longest.size;

    const fresh = found.filter((p) => !longest.has(p.id));
    if (fresh.length) {
      const ends = endsAtFromNow(months);
      await supabase.from("subscriptions").insert(
        fresh.map((p) => ({
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
    }
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
  const params = new URLSearchParams({ granted: String(found.length - extended) });
  if (extended) params.set("extended", String(extended));
  if (missing.length) params.set("missing", missing.join(","));
  redirect(`/admin/enrolment?${params.toString()}`);
}

export async function revokeSubscription(formData: FormData) {
  await assertArea("enrolment");
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
  await assertArea("enrolment");
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
  await assertArea("enrolment");
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
  await assertArea("enrolment");
  const id = str(formData.get("id"));
  // Any whole number of months, not a fixed 1/3/6/12 — his ask, 1 September.
  // Clamped to the same 1-36 the box allows, so a hand-posted 9999 cannot set
  // a subscription running to the next century.
  const months = Math.min(36, Math.max(1, Math.round(num(formData.get("months"), 1))));
  const supabase = createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("ends_at")
    .eq("id", id)
    .maybeSingle();
  // Runs on from the existing expiry where there is one left to run on from,
  // and from today where access has already lapsed — see extendedEndsAt.
  const ends = extendedEndsAt((sub?.ends_at as string | null) ?? null, months);
  await supabase
    .from("subscriptions")
    .update({ ends_at: ends, status: "active" })
    .eq("id", id);
  revalidatePath("/admin/enrolment");
  redirect(`/admin/enrolment?extended_to=${encodeURIComponent(formatDate(ends))}`);
}

// Save the wording of the granted-access email. Blank fields fall back to the
// built-in draft, so clearing a box restores the default rather than sending
// an empty email.

// Past students in bulk, ANY size: upload the Excel template (or paste), rows
// queue, and a cron drips the emails slowly so the batch never looks like spam.
export async function queuePastStudents(formData: FormData) {
  await assertArea("enrolment");
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
