"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../_lib/util";
import { notifyByEmail, emailShell } from "@/lib/notify";

const TIERS = ["bronze", "silver", "gold"];

function enrolledEmail(name: string | null, courseTitle: string, tier: string, months: number) {
  return {
    subject: `🎉 You're enrolled in ${courseTitle}`,
    html: emailShell(
      "You're enrolled! 🎉",
      `<p>Hi ${name || "there"},</p>
       <p>You now have <strong>${tier}</strong> access to <strong>${courseTitle}</strong> for ${months} month${months === 1 ? "" : "s"}.</p>
       <p>Log in to start learning. 📚 Good luck with your prep! 💪</p>`,
    ),
  };
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

  const { data: course } = await supabase.from("courses").select("title").eq("id", courseId).maybeSingle();
  const msg = enrolledEmail(profile.full_name, course?.title ?? "your course", tier, months);
  await notifyByEmail({
    studentId: profile.id,
    email: profile.email,
    subject: msg.subject,
    html: msg.html,
    template: "enrolment_granted",
    payload: { courseId, tier, months },
  });

  revalidatePath("/admin/enrolment");
  redirect("/admin/enrolment?granted=1");
}

export async function bulkGrant(formData: FormData) {
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

    const { data: course } = await supabase.from("courses").select("title").eq("id", courseId).maybeSingle();
    const title = course?.title ?? "your course";
    await Promise.all(
      found.map((p) => {
        const msg = enrolledEmail(p.full_name, title, tier, months);
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
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("subscriptions").update({ status: "cancelled", auto_renew: false }).eq("id", id);
  revalidatePath("/admin/enrolment");
}

export async function extendSubscription(formData: FormData) {
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
