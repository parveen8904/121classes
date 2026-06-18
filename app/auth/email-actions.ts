"use server";

import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailShell, emailConfigured } from "@/lib/notify";

function baseUrl(): string {
  const h = headers();
  const host = h.get("host") || "www.121caclasses.com";
  const proto = h.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

type Result = { ok: boolean; error?: string };

// New account: create the user (unconfirmed) and email a verification link via
// OUR Mailgun. The student must click it before they can use the portal.
export async function registerWithVerification(formData: FormData): Promise<Result> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!email || password.length < 6) return { ok: false, error: "Enter your email and a password of at least 6 characters." };
  if (!(await emailConfigured())) return { ok: false, error: "Email isn't set up yet. Please ask the admin to add the Mailgun key." };

  const svc = createServiceClient();
  const redirectTo = `${baseUrl()}/auth/callback?next=/dashboard`;
  const { data, error } = await svc.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { data: { full_name: name }, redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    const msg = (error?.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { ok: false, error: "An account with this email already exists. Please log in, or use “Forgot password”." };
    }
    return { ok: false, error: error?.message || "Could not start sign-up. Please try again." };
  }

  const link = data.properties.action_link;
  const html = emailShell(
    "Verify your email",
    `<p>Hi ${name || "there"},</p>
     <p>Welcome to 121 CA Classes! Please confirm your email to activate your account:</p>
     <p><a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Verify my email</a></p>
     <p style="color:#64748b;font-size:13px">Or paste this link in your browser:<br/>${link}</p>
     <p>After verifying, log in with your email and password.</p>`,
  );
  const sent = await sendEmail(email, "Verify your email — 121 CA Classes", html);
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
  const redirectTo = `${baseUrl()}/auth/callback?next=/dashboard`;
  const { data, error } = await svc.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
  const link = data?.properties?.action_link;
  if (error || !link) return { ok: false, error: "Couldn't generate a new link." };
  const html = emailShell(
    "Verify your email",
    `<p>Click below to verify your email and sign in:</p>
     <p><a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Verify &amp; sign in</a></p>
     <p style="color:#64748b;font-size:13px">Or paste this link:<br/>${link}</p>`,
  );
  const sent = await sendEmail(email, "Verify your email — 121 CA Classes", html);
  return sent ? { ok: true } : { ok: false, error: "Couldn't send the email." };
}

// Forgot password: email a reset link via OUR Mailgun. Always reports success
// (no account enumeration).
export async function sendPasswordReset(formData: FormData): Promise<Result> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Enter your email." };
  if (!(await emailConfigured())) return { ok: false, error: "Email isn't set up yet. Please ask the admin to add the Mailgun key." };

  const svc = createServiceClient();
  const redirectTo = `${baseUrl()}/auth/callback?next=/auth/reset-password`;
  const { data } = await svc.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  const link = data?.properties?.action_link;
  if (link) {
    const html = emailShell(
      "Reset your password",
      `<p>We received a request to reset your 121 CA Classes password.</p>
       <p><a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Set a new password</a></p>
       <p style="color:#64748b;font-size:13px">Or paste this link:<br/>${link}</p>
       <p>If you didn't request this, you can ignore this email.</p>`,
    );
    await sendEmail(email, "Reset your password — 121 CA Classes", html);
  }
  return { ok: true };
}
