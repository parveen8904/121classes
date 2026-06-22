"use server";

import { randomUUID } from "node:crypto";
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
// OUR Mailgun. We DON'T ask for a password here — the student picks it after
// they verify (the link signs them in, then they're sent to "set password").
// A throwaway password is used only to create the account.
export async function registerWithVerification(formData: FormData): Promise<Result> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Enter your email address." };
  if (!(await emailConfigured())) return { ok: false, error: "Email isn't set up yet. Please ask the admin to add the Mailgun key." };

  const svc = createServiceClient();
  const password = randomUUID() + randomUUID(); // temporary — replaced when they set their own
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

  // Verify via our own server-side route (token_hash flow), which sets the
  // session and sends them straight to "set your password".
  const link = `${baseUrl()}/auth/confirm?token_hash=${tokenHash}&type=signup&next=/auth/set-password`;
  const html = emailShell(
    "Verify your email",
    `<p>Hi ${name || "there"},</p>
     <p>Welcome to CA Parveen Sharma classes! Please confirm your email to activate your account:</p>
     <p><a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Verify my email</a></p>
     <p style="color:#64748b;font-size:13px">Or paste this link in your browser:<br/>${link}</p>
     <p>After verifying, you'll choose your password — then you're in.</p>`,
  );
  const sent = await sendEmail(email, "Verify your email — CA Parveen Sharma", html);
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
  const link = `${baseUrl()}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/auth/set-password`;
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
  const { data } = await svc.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  const link = tokenHash ? `${baseUrl()}/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/auth/reset-password` : "";
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
