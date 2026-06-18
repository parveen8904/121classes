"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailShell, emailConfigured } from "@/lib/notify";
import { str, nullable } from "../_lib/util";

const ROLES = ["student", "admin", "faculty"];

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

function baseUrl(): string {
  const h = headers();
  return `${h.get("x-forwarded-proto") || "https"}://${h.get("host") || "www.121caclasses.com"}`;
}

async function emailSetPasswordLink(email: string, name: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${baseUrl()}/auth/callback?next=/auth/reset-password` },
  });
  const url = data?.properties?.action_link;
  if (!url || !(await emailConfigured())) return false;
  const html = emailShell(
    "Your 121 CA Classes account is ready",
    `<p>Hi ${name || "there"},</p>
     <p>An account has been created for you at <strong>121 CA Classes</strong>. Set your password to get started:</p>
     <p><a href="${url}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Set my password</a></p>
     <p style="color:#64748b;font-size:13px">Or paste this link:<br/>${url}</p>
     <p>Afterwards, log in with your email and the password you chose.</p>`,
  );
  return sendEmail(email, "Set your password — 121 CA Classes", html);
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
  const id = str(formData.get("id"));
  if (!id) return;
  const role = str(formData.get("role"));
  const supabase = createClient();
  await supabase
    .from("profiles")
    .update({
      full_name: nullable(formData.get("full_name")),
      phone: nullable(formData.get("phone")),
      target_attempt: nullable(formData.get("target_attempt")),
      role: ROLES.includes(role) ? role : "student",
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
