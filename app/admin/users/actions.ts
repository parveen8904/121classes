"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { emailConfigured } from "@/lib/notify";
import { sendTemplate } from "@/lib/emailTemplates";
import { str, nullable } from "../_lib/util";

// "supporter" is a role of its own, not a student.
//
// Left as students, the 105 imported sponsors would have been counted in the
// student figures AND swept into every student broadcast, WhatsApp campaign and
// re-engagement mailing — the same unwanted mail the silent import existed to
// avoid, arriving through a different door.
const ROLES = ["student", "supporter", "admin", "faculty", "operator"];

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// The "your account is ready" email.
//
// This used to send Supabase's own action_link — an address on
// xmeltwyfvzhhurtcjfiu.supabase.co — and print it underneath as text as well.
// Both were wrong. It looked like it came from somebody else, and it did not
// work: that address is consumed the first time it is fetched, so a mail
// scanner or a link preview burned it before the student ever clicked, leaving
// them with "link expired". The rest of the site already does this correctly:
// take the token itself and confirm it on OUR domain. Button only — a one-time
// token is never printed as text.
async function emailSetPasswordLink(email: string, name: string): Promise<boolean> {
  if (!(await emailConfigured())) return false;
  const svc = createServiceClient();
  const { data } = await svc.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) return false;
  return sendTemplate("account_created", email, {
    name: name || "there",
    action_url: `https://caparveensharma.com/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/auth/set-password`,
    action_label: "Set my password",
  });
}

// Admin adds one or many users (no verification needed — admin-trusted). Each is
// created confirmed, then emailed a "set your password" link.
export async function addUsers(formData: FormData) {
  if (!(await requireAdmin())) return;
  const role = ROLES.includes(str(formData.get("role"))) ? str(formData.get("role")) : "student";
  const lines = str(formData.get("bulk")).split(/\n/).map((l) => l.trim()).filter(Boolean);
  const svc = createServiceClient();
  let created = 0, invited = 0, failed = 0;

  for (const line of lines) {
    const m = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (!m) { failed++; continue; }
    const email = m[0].toLowerCase();
    const name = line.replace(m[0], "").replace(/[,<>]/g, "").trim();
    const { data: cu, error } = await svc.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error || !cu?.user) { failed++; continue; }
    created++;
    await svc.from("profiles").update({ full_name: name || null, role }).eq("id", cu.user.id);
    if (await emailSetPasswordLink(email, name)) invited++;
  }
  revalidatePath("/admin/users");
  redirect(`/admin/users?added=${created}&invited=${invited}&failed=${failed}`);
}

// Per-user: (re)send the set-password email.
export async function sendSetPasswordEmail(formData: FormData) {
  if (!(await requireAdmin())) return;
  const email = str(formData.get("email"));
  const name = str(formData.get("name"));
  if (email) await emailSetPasswordLink(email, name);
  redirect("/admin/users?invited=1");
}

// Per-user rescue: admin sets a password directly.
//
// This said it had worked and had not. Two silences: a password Supabase
// refused came back as an error nobody read, and the profile was then stamped
// has_password anyway — so the page showed "password set", the founder handed
// it to the student, and the student could not log in. A short password did not
// even redirect: the form simply appeared to do nothing.
//
// The account's policy requires an upper case letter, a lower case letter, a
// digit and a symbol, so "student123" is refused however long it is. That is
// now said on the form and repeated in the error.
export async function adminSetPassword(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const password = str(formData.get("password"));
  if (!id) return;

  const problem = passwordProblem(password);
  if (problem) redirect(`/admin/users/${id}?pwerr=${encodeURIComponent(problem)}`);

  const svc = createServiceClient();
  const { error } = await svc.auth.admin.updateUserById(id, { password });
  if (error) {
    console.error("[admin] password not set for", id, error.message);
    redirect(`/admin/users/${id}?pwerr=${encodeURIComponent(error.message)}`);
  }

  // Only once it is actually true.
  await svc.from("profiles").update({ has_password: true }).eq("id", id);
  revalidatePath(`/admin/users/${id}`);
  redirect(`/admin/users/${id}?pwset=${encodeURIComponent(password)}`);
}

/** The account's own rule, checked here so the admin is told before Supabase is. */
function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Use at least 8 characters.";
  if (p.length > 72) return "Use 72 characters or fewer.";
  if (!/[a-z]/.test(p)) return "Add a lower case letter.";
  if (!/[A-Z]/.test(p)) return "Add a CAPITAL letter.";
  if (!/[0-9]/.test(p)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(p)) return "Add a symbol, for example ! or @ or #.";
  return null;
}

export async function updateUser(formData: FormData) {
  if (!(await requireAdmin())) return; // only the super admin manages users & rights
  const id = str(formData.get("id"));
  if (!id) return;
  const role = str(formData.get("role"));
  const safeRole = ROLES.includes(role) ? role : "student";
  // Rights apply to operator/faculty; admins have everything, students nothing.
  const perms = safeRole === "operator" || safeRole === "faculty" ? formData.getAll("perm").map(String) : [];
  const supabase = createClient();
  await supabase
    .from("profiles")
    .update({
      full_name: nullable(formData.get("full_name")),
      designation: nullable(formData.get("designation")),
      phone: nullable(formData.get("phone")),
      target_attempt: nullable(formData.get("target_attempt")),
      permissions: perms,
      role: safeRole,
      // A supporter pays for other students. It is not a role — they may be a
      // student themselves — so it rides alongside rather than replacing one.
      is_supporter: formData.get("is_supporter") === "on",
      address_line1: nullable(formData.get("address_line1")),
      address_line2: nullable(formData.get("address_line2")),
      city: nullable(formData.get("city")),
      state: nullable(formData.get("state")),
      pincode: nullable(formData.get("pincode")),
      gstin: nullable(formData.get("gstin")),
      business_name: nullable(formData.get("business_name")),
    })
    .eq("id", id);
  revalidatePath(`/admin/users/${id}`);
  revalidatePath("/admin/users");
}

// Wipe a student's study plan COMPLETELY (plan, schedule, remarks, progress
// ticks) so they start fresh, exactly like a brand-new student.
export async function resetStudyPlan(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const svc = createServiceClient();
  await svc.from("study_plans").delete().eq("user_id", id);
  await svc.from("class_watch").delete().eq("student_id", id);
  revalidatePath(`/admin/users/${id}`);
  redirect(`/admin/users/${id}?planreset=1`);
}

// ---- reset a student's attempts ----
//
// A student who could not upload, uploaded the wrong file, or sat a paper by
// accident had no way back: an attempt is one per student per test, so the test
// was simply gone for them. The reset button existed only on the founder's OWN
// preview of a paper, not on anybody else's account.
//
// This removes the attempt and everything built from it, so the student can sit
// the test again from the beginning. The uploaded answer book and the checked
// copy are left in storage — they cost nothing, and deleting a student's own
// work on a guessed target is exactly what must not happen here.
export async function resetStudentTests(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const what = str(formData.get("what")); // descriptive | mcq | case | all
  if (!id || !what) return;

  const svc = createServiceClient();
  const done: string[] = [];

  if (what === "descriptive" || what === "all") {
    const { count } = await svc
      .from("descriptive_attempts")
      .select("id", { count: "exact", head: true })
      .eq("student_id", id);
    await svc.from("descriptive_attempts").delete().eq("student_id", id);
    done.push(`${count ?? 0} descriptive`);
  }
  if (what === "mcq" || what === "all") {
    const { count } = await svc
      .from("mcq_attempts")
      .select("id", { count: "exact", head: true })
      .eq("student_id", id);
    await svc.from("mcq_attempts").delete().eq("student_id", id);
    done.push(`${count ?? 0} MCQ`);
  }
  if (what === "case" || what === "all") {
    try {
      const { count } = await svc
        .from("case_attempts")
        .select("id", { count: "exact", head: true })
        .eq("student_id", id);
      await svc.from("case_attempts").delete().eq("student_id", id);
      done.push(`${count ?? 0} case study`);
    } catch { /* table optional */ }
  }

  revalidatePath(`/admin/users/${id}`);
  redirect(`/admin/users/${id}?testsreset=${encodeURIComponent(done.join(", "))}`);
}

// ---- get the bulk-granted students in ----
//
// 1,466 accounts created since 1 August have never once been logged into. They
// were emailed a "set my password" button, which is a single-use token that
// expires within the hour — the wrong instrument for a student who reads email
// the next morning. This sends a password instead: it does not expire, it works
// from any device, and it can be read aloud over a phone.
export async function rescueFirstLogins(formData?: FormData) {
  if (!(await requireAdmin())) return;
  // "tried" = only those who asked for a link themselves and still are not in.
  // Anything else writes to every student who has never signed in, most of whom
  // have never even opened the login page.
  const onlyThoseWhoTried = str(formData?.get("scope") ?? null) === "tried";
  const { sendFirstLoginPasswords } = await import("@/lib/firstLoginRescue");
  const r = await sendFirstLoginPasswords(onlyThoseWhoTried ? 200 : 100, { onlyThoseWhoTried });
  revalidatePath("/admin/users");
  redirect(
    `/admin/users?rescued=${r.fixed}&rescueleft=${r.remaining}` +
      (r.failed[0] ? `&rescueerr=${encodeURIComponent(r.failed[0].slice(0, 160))}` : ""),
  );
}

/**
 * Import SUPPORTERS in bulk, quietly.
 *
 * addUsers() emails every address a set-password link. That is right for
 * students the office is onboarding and wrong for a list of sponsors and
 * resellers who have not asked to hear from us — 107 unexpected emails is a
 * complaint, not an onboarding. This creates the accounts and nothing else:
 * no email is sent, and each is marked as a supporter so /supporter opens for
 * them the moment they do sign in.
 *
 * One line each, "Name <email>" or "Name, email" — an existing account is
 * flipped to supporter rather than duplicated.
 */
export async function importSupporters(formData: FormData) {
  if (!(await requireAdmin())) return;
  const lines = str(formData.get("bulk")).split(/\n/).map((l) => l.trim()).filter(Boolean);
  const svc = createServiceClient();
  let created = 0, marked = 0, failed = 0;

  for (const line of lines) {
    const m = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (!m) { failed++; continue; }
    const email = m[0].toLowerCase();
    const name = line.replace(m[0], "").replace(/[,<>]/g, "").trim();

    const { data: existing } = await svc.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (existing?.id) {
      // An existing STUDENT who also sponsors stays a student — only a plain
      // account with no other purpose becomes a supporter outright.
      await svc.from("profiles").update({ is_supporter: true, full_name: name || undefined }).eq("id", existing.id);
      marked++;
      continue;
    }

    const { data: cu, error } = await svc.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error || !cu?.user) { failed++; continue; }
    await svc.from("profiles").update({ full_name: name || null, is_supporter: true, role: "supporter" }).eq("id", cu.user.id);
    created++;
  }
  revalidatePath("/admin/users");
  redirect(`/admin/users?supp_created=${created}&supp_marked=${marked}&supp_failed=${failed}`);
}

// HAND IN A PAPER FOR A STUDENT WHO CANNOT.
//
// Manvi Maroti tried for two days. Her file was fine, the paper selection was
// fine, storage was fine — a 3.9 MB scan that our shrinker could not reduce on
// her phone, crawling up a slow line behind a progress message that could not
// move. She is a paying student and her paper still is not marked.
//
// Every fix for that is worth having and none of them can be relied on tonight,
// because they all run on HER phone. This does not: she sends the file however
// she can — email, WhatsApp, in person — and somebody here puts it in from a
// desk with a real connection.
//
// It is the SAME attempt a student creates: the same key, the same step marking
// guide, the same examiner, the same annotated copy back. Only the hands that
// uploaded it differ, and that is written down.
export async function submitPaperForStudent(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!(await requireAdmin())) return { ok: false, error: "Admins only." };

  const studentId = str(formData.get("student_id"));
  const choice = str(formData.get("paper"));      // "mock:<id>" or a sections id
  const fileUrl = str(formData.get("file_url"));  // "secure:paper-check/…"
  if (!studentId || !choice || !fileUrl) {
    return { ok: false, error: "Choose which paper it is and upload the PDF first." };
  }

  const svc = createServiceClient();
  const { data: me } = await svc.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  const by = String(me?.full_name ?? me?.email ?? "admin");

  const isMock = choice.startsWith("mock:");
  const mockPaperId = isMock ? choice.slice(5) : null;
  const sectionId = isMock ? null : choice;

  // One attempt per student per paper, exactly as the student's own route does.
  // A paper already being marked is not replaced — that would throw away work an
  // examiner may be halfway through.
  let q = svc.from("descriptive_attempts").select("id, review_status").eq("student_id", studentId);
  q = isMock ? q.eq("mock_paper_id", mockPaperId!) : q.eq("section_id", sectionId!);
  const { data: existing } = await q.maybeSingle();
  if (existing) {
    if (existing.review_status !== "checked") {
      return { ok: false, error: "That paper is already with us and is being checked." };
    }
    await svc.from("descriptive_attempts").delete().eq("id", existing.id);
  }

  const now = new Date();
  const { data: made, error } = await svc
    .from("descriptive_attempts")
    .insert({
      student_id: studentId,
      section_id: sectionId,
      mock_paper_id: mockPaperId,
      started_at: now.toISOString(),
      deadline_at: new Date(now.getTime() + 3600_000).toISOString(),
      submitted_at: now.toISOString(),
      status: "submitted",
      review_status: "pending",
      file_url: fileUrl,
      source: "paper_check",
    })
    .select("id")
    .maybeSingle();
  if (error || !made) return { ok: false, error: error?.message ?? "Could not record it." };

  // WHO PUT IT IN. On the record, so a paper nobody remembers uploading is never
  // a mystery, and so this cannot quietly become the normal way papers arrive.
  try {
    await svc.from("student_activity").insert({
      student_id: studentId,
      kind: "test_submitted",
      detail: { note: `Answer book uploaded on the student's behalf by ${by}`, by, admin_upload: true },
    });
  } catch { /* the attempt matters, the note does not */ }

  // Mark it now rather than waiting for the sweep.
  try {
    const { waitUntil } = await import("@vercel/functions");
    const { gradeSubmittedPaper } = await import("@/app/learn/section/[sectionId]/paperActions");
    waitUntil(gradeSubmittedPaper(String(made.id)).catch(() => undefined));
  } catch { /* the nightly cron will pick it up */ }

  revalidatePath(`/admin/users/${studentId}`);
  return { ok: true };
}
