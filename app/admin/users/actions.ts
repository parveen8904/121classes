"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { emailConfigured } from "@/lib/notify";
import { sendTemplate } from "@/lib/emailTemplates";
import { str, nullable } from "../_lib/util";

const ROLES = ["student", "admin", "faculty", "operator"];

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
export async function adminSetPassword(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const password = str(formData.get("password"));
  if (!id || password.length < 6) return;
  const svc = createServiceClient();
  await svc.auth.admin.updateUserById(id, { password });
  await svc.from("profiles").update({ has_password: true }).eq("id", id);
  revalidatePath(`/admin/users/${id}`);
  redirect(`/admin/users/${id}?pwset=1`);
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
      phone: nullable(formData.get("phone")),
      target_attempt: nullable(formData.get("target_attempt")),
      permissions: perms,
      role: safeRole,
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
