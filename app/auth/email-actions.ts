"use server";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { emailConfigured } from "@/lib/notify";
import { sendTemplate } from "@/lib/emailTemplates";
import { allowEmailAction } from "@/lib/throttle";

// Always build auth links on the canonical domain (not whichever alias the user
// happened to open), so verify/reset links are consistently caparveensharma.com.
const SITE_URL = "https://caparveensharma.com";

type Result = { ok: boolean; error?: string };

// New account: create the user (unconfirmed) and email a verification link via
// OUR Mailgun. We DON'T ask for a password here — the student picks it after
// they verify (the link signs them in, then they're sent to "set password").
// A throwaway password is used only to create the account.
export async function registerWithVerification(formData: FormData): Promise<Result> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const phone = String(formData.get("phone") || "").trim().slice(0, 20);
  if (!email) return { ok: false, error: "Enter your email address." };
  if (!(await emailConfigured())) return { ok: false, error: "Email isn't set up yet. Please ask the admin to add the Mailgun key." };
  // Anyone can call this and every call sends an email. Generous enough that a
  // real person retrying never notices, tight enough that a script cannot burn
  // the mail quota that students' password resets depend on.
  if (!(await allowEmailAction("signup", email, { perEmail: 3, perIp: 10, seconds: 3600 }))) {
    return { ok: false, error: "Too many sign-up attempts just now. Please wait a few minutes and try again." };
  }

  const svc = createServiceClient();
  // Temporary password, replaced when the student sets their own. Must satisfy
  // the project's password policy (needs lower + UPPER + digit + symbol): plain
  // UUIDs are lowercase-hex only and were REJECTED (weak_password 422), which
  // silently blocked every new registration — hence the "Aa1!" prefix.
  // (One UUID, not two: the policy also caps passwords at 72 characters.)
  const password = "Aa1!" + randomUUID();
  const { data, error } = await svc.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { data: { full_name: name } },
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    const msg = (error?.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { ok: false, error: "An account with this email already exists. Please log in, or use “Forgot password”." };
    }
    return { ok: false, error: error?.message || "Could not start sign-up. Please try again." };
  }

  // Save the optional WhatsApp number so staff can help this student even
  // before their first login (best-effort — never blocks registration).
  const newUserId = data?.user?.id;
  if (phone && newUserId) {
    try { await svc.from("profiles").update({ phone }).eq("id", newUserId); } catch { /* ignore */ }
  }

  // Verify via our own server-side route (token_hash flow), which sets the
  // session and sends them straight to "set your password".
  const link = `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=signup&next=/auth/set-password`;
  const sent = await sendTemplate("email_verify", email, {
    name: name || "there",
    heading: "Verify your email",
    action_url: link,
    action_label: "Verify my email",
  });
  if (!sent) return { ok: false, error: "Couldn't send the verification email. Please try again shortly." };
  return { ok: true };
}

// Resend a verification/sign-in link to an unverified user (via our Mailgun).
// A magic link both signs them in and confirms their email.
export async function resendVerification(formData: FormData): Promise<Result> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Missing email." };
  if (!(await emailConfigured())) return { ok: false, error: "Email isn't set up yet." };
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { ok: false, error: "Couldn't generate a new link." };
  const link = `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/auth/set-password`;
  const sent = await sendTemplate("email_verify_resend", email, {
    heading: "Verify your email",
    action_url: link,
    action_label: "Verify & sign in",
  });
  return sent ? { ok: true } : { ok: false, error: "Couldn't send the email." };
}

// "Trouble logging in" call-back request (shown after 2 failed attempts):
// lands in the admin inbox + emails the faculty so staff can call the student.
export async function requestLoginHelp(formData: FormData): Promise<Result> {
  const name = String(formData.get("name") || "").trim().slice(0, 80);
  const phone = String(formData.get("phone") || "").trim().slice(0, 20);
  const email = String(formData.get("email") || "").trim().slice(0, 120);
  if (!phone) return { ok: false, error: "Enter a WhatsApp number." };
  const svc = createServiceClient();

  // Try to SOLVE it first. Most of these are a forgotten password or a second
  // email address — facts the site already holds — so the student gets a link
  // in seconds instead of waiting for someone to call back. A person is only
  // troubled when the site genuinely cannot tell what is wrong.
  let rescue: { handled: boolean; note: string } = { handled: false, note: "not attempted" };
  try {
    const { rescueLogin } = await import("@/lib/loginRescue");
    rescue = await rescueLogin({ name, phone, email });
  } catch (e) {
    rescue = { handled: false, note: `auto-help failed: ${String(e).slice(0, 120)}` };
  }

  try {
    await svc.from("page_questions").insert({
      user_id: null,
      page_path: "login-help",
      question:
        `📞 LOGIN HELP REQUEST — ${name || "No name"} · WhatsApp: ${phone}${email ? ` · tried email: ${email}` : ""}` +
        `\n${rescue.handled ? "✅ Handled automatically" : "⚠️ Needs a person"}: ${rescue.note}`,
      // Solved requests do not sit in the open queue.
      status: rescue.handled ? "answered" : "open",
    });
  } catch { /* the email below still goes out */ }

  // Only bother a human when the site could not settle it.
  if (!rescue.handled) {
    try {
      const { notifyFaculty } = await import("@/lib/notify");
      await notifyFaculty(
        "A student needs help logging in",
        `Name: ${name || "—"}\nWhatsApp: ${phone}\nEmail they tried: ${email || "—"}\n\n` +
          `The site tried to solve this automatically and could not: ${rescue.note}\n\n` +
          `Please call them back. (From the login page after failed attempts.)`,
      );
    } catch { /* inbox row above is enough */ }
  }
  return { ok: true };
}

// Forgot password: email a reset link via OUR Mailgun. Always reports success
// (no account enumeration).
export async function sendPasswordReset(formData: FormData): Promise<Result> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Enter your email." };
  if (!(await emailConfigured())) return { ok: false, error: "Email isn't set up yet. Please ask the admin to add the Mailgun key." };
  if (!(await allowEmailAction("reset", email, { perEmail: 5, perIp: 15, seconds: 3600 }))) {
    // Same wording as success, so this never becomes a way to discover which
    // addresses have an account here.
    return { ok: true };
  }

  const svc = createServiceClient();
  const { data } = await svc.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  const link = tokenHash ? `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/auth/reset-password` : "";
  if (link) {
    await sendTemplate("password_reset", email, {
      heading: "Reset your password",
      action_url: link,
      action_label: "Set a new password",
    });
  }
  return { ok: true };
}
