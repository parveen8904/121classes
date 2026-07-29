import { createServiceClient } from "@/lib/supabase/service";
import { sendTemplate } from "@/lib/emailTemplates";

// Provision access here for a course bought somewhere else (today: Aldine,
// his WooCommerce site). One call does everything a hand-grant does: find or
// create the account, grant the subscription, put it on the student's shelf,
// and send the right email — a set-password link for a brand-new student, a
// plain "it's ready, log in" for someone who already has an account. The
// welcome guide then goes out on their first dashboard visit like any other
// new student.
//
// Everything is idempotent: the caller records (source, order_ref,
// product_key) in partner_orders BEFORE calling, and a duplicate insert there
// stops a WooCommerce webhook retry from granting twice.

const SITE = "https://caparveensharma.com";

export type PartnerGrant = {
  email: string;
  name: string;
  phone?: string;
  courseId: string;
  subjectId: string | null;
  tier: string;
  months: number;
  source: string; // e.g. "aldine" — becomes the subscription channel
};

export type PartnerResult =
  | { ok: true; studentId: string; created: boolean; alreadyHad: boolean }
  | { ok: false; error: string };

function endsAtFromNow(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

async function findOrCreateUser(
  svc: ReturnType<typeof createServiceClient>,
  email: string,
  name: string,
  phone?: string,
): Promise<{ id: string; created: boolean } | null> {
  const { data: prof } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
  if (prof?.id) return { id: prof.id as string, created: false };

  const { data: cu, error } = await svc.auth.admin.createUser({
    email,
    email_confirm: true, // they proved the address by buying with it
    user_metadata: { full_name: name },
  });
  if (error || !cu?.user) {
    // The auth user may exist without a profile row (half-created earlier).
    const retry = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
    return retry.data?.id ? { id: retry.data.id as string, created: false } : null;
  }
  await svc.from("profiles").update({ full_name: name || null, ...(phone ? { phone } : {}) }).eq("id", cu.user.id);
  return { id: cu.user.id, created: true };
}

// Same shelf logic as a hand-grant: without this the student can't SEE what
// they were given. subjectId null = whole course → shelve every subject.
async function addToShelf(svc: ReturnType<typeof createServiceClient>, studentId: string, courseId: string, subjectId: string | null) {
  let subjectIds: string[] = subjectId ? [subjectId] : [];
  if (!subjectId) {
    const { data } = await svc.from("subjects").select("id").eq("course_id", courseId);
    subjectIds = (data ?? []).map((s) => s.id as string);
  }
  const { data: haveC } = await svc.from("my_courses").select("student_id").eq("course_id", courseId).eq("student_id", studentId);
  if (!haveC?.length) await svc.from("my_courses").insert({ student_id: studentId, course_id: courseId });
  for (const sid of subjectIds) {
    const { data: haveS } = await svc.from("my_subjects").select("student_id").eq("subject_id", sid).eq("student_id", studentId);
    if (!haveS?.length) await svc.from("my_subjects").insert({ student_id: studentId, subject_id: sid });
  }
}

export async function provisionPartnerPurchase(g: PartnerGrant): Promise<PartnerResult> {
  const svc = createServiceClient();
  const email = g.email.trim().toLowerCase();
  if (!email || !g.courseId) return { ok: false, error: "missing email or course" };

  const user = await findOrCreateUser(svc, email, g.name, g.phone);
  if (!user) return { ok: false, error: "could not create the account" };

  // An identical active subscription means a webhook replay or a re-purchase
  // mistake — do not stack another one silently.
  const { data: existing } = await svc
    .from("subscriptions")
    .select("id")
    .eq("student_id", user.id)
    .eq("course_id", g.courseId)
    .is("subject_id", g.subjectId ?? null)
    .eq("status", "active")
    .limit(1);
  const alreadyHad = Boolean(existing?.length);

  if (!alreadyHad) {
    const { data: plan } = await svc
      .from("plans").select("id").eq("tier", g.tier).eq("is_active", true).order("rank").limit(1).maybeSingle();
    if (!plan?.id) return { ok: false, error: `no active plan for tier "${g.tier}"` };

    const { error: subErr } = await svc.from("subscriptions").insert({
      student_id: user.id,
      course_id: g.courseId,
      subject_id: g.subjectId,
      plan_id: plan.id,
      channel: g.source,
      ends_at: endsAtFromNow(g.months),
      status: "active",
      auto_renew: false,
    });
    if (subErr) return { ok: false, error: subErr.message };
    await addToShelf(svc, user.id, g.courseId, g.subjectId);
  }

  // The email. New account → set-password button (token_hash on OUR domain,
  // never Supabase's action_link, and never printed as text). Existing
  // account → plain login button.
  const { data: course } = await svc.from("courses").select("title").eq("id", g.courseId).maybeSingle();
  let courseTitle = course?.title ?? "your course";
  if (g.subjectId) {
    const { data: subj } = await svc.from("subjects").select("title").eq("id", g.subjectId).maybeSingle();
    if (subj?.title) courseTitle = `${courseTitle} — ${subj.title}`;
  }

  let actionUrl = `${SITE}/login`;
  let actionLabel = "Log in and start";
  if (user.created) {
    const { data: link } = await svc.auth.admin.generateLink({ type: "recovery", email });
    const th = link?.properties?.hashed_token;
    if (th) {
      actionUrl = `${SITE}/auth/confirm?token_hash=${th}&type=recovery&next=/auth/set-password`;
      actionLabel = "Set my password & start";
    }
  }
  await sendTemplate("purchase_provisioned", email, {
    name: g.name || "student",
    course: courseTitle,
    email,
    action_url: actionUrl,
    action_label: actionLabel,
  }).catch(() => false);

  return { ok: true, studentId: user.id, created: user.created, alreadyHad };
}
