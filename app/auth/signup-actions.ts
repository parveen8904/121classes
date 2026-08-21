"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { emailConfigured } from "@/lib/notify";
import { sendTemplate } from "@/lib/emailTemplates";
import { allowEmailAction } from "@/lib/throttle";
import { whyAddressLooksWrong } from "@/lib/emailSanity";
import { passwordProblem } from "@/lib/passwordRule";
import { sendPhoneOtp, verifyPhoneOtp, toE164, phoneVerifyLive } from "@/lib/phoneVerify";

// THE PHONE-FIRST SIGN-UP (founder's choice, 21 Aug).
//
// One screen — name, mobile, email — verify the MOBILE by a WhatsApp OTP, set a
// password, and you are in immediately. The email is verified afterwards by a
// link (a banner nags until it is clicked); it never blocks access. This makes
// WhatsApp meaningful (it is what proves you are real) without the friction of
// waiting for an email to get in.
//
// SAFETY: the whole thing is gated on phoneVerifyLive(). If OTP sending is ever
// switched off (Meta template gate), signupSendOtp reports fallback:true and the
// form quietly reverts to the old email-link registration — a student can always
// make an account.

const SITE_URL = "https://caparveensharma.com";

export type SendResult =
  | { ok: true }
  | { ok: false; error: string; fallback?: boolean };

/** Step 1 — validate, make sure the email is free, send the WhatsApp code. */
export async function signupSendOtp(formData: FormData): Promise<SendResult> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const mobile = String(formData.get("phone") || "").trim();

  if (!email) return { ok: false, error: "Enter your email address." };
  const badAddress = whyAddressLooksWrong(email);
  if (badAddress) return { ok: false, error: badAddress };
  if (!toE164(mobile)) return { ok: false, error: "Enter a valid 10-digit mobile number." };

  // If OTP is not live, tell the form to use the old email-link flow instead.
  if (!(await phoneVerifyLive())) {
    return { ok: false, error: "Phone verification is temporarily unavailable — use email sign-up.", fallback: true };
  }

  const svc = createServiceClient();
  // Email already registered? Say so before sending a code.
  const { data: existing } = await svc.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    return { ok: false, error: "An account with this email already exists. Please log in, or use “Forgot password”." };
  }

  // Rate-limit on the email, same budget as the email sign-up path.
  if (!(await allowEmailAction("signup", email, { perEmail: 5, perIp: 15, seconds: 3600 }))) {
    return { ok: false, error: "Too many attempts just now. Please wait a few minutes and try again." };
  }

  const sent = await sendPhoneOtp(null, mobile);
  if (!sent.ok) {
    if (sent.reason === "cooldown") return { ok: false, error: "A code was just sent — please wait a minute before asking for another." };
    if (sent.reason === "bad_number") return { ok: false, error: "Enter a valid 10-digit mobile number." };
    // not_ready / send_failed → let them fall back to email sign-up.
    return { ok: false, error: "Couldn't send the WhatsApp code — please use email sign-up instead.", fallback: true };
  }
  return { ok: true };
}

export type CompleteResult = { ok: true; email: string } | { ok: false; error: string };

/** Step 2 — check the code, create the account with their password, mark the
 * phone verified, and send the email-verification link. The client then signs
 * them in with the password and lands them on the dashboard. */
export async function signupComplete(formData: FormData): Promise<CompleteResult> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const mobile = String(formData.get("phone") || "").trim();
  const code = String(formData.get("code") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !toE164(mobile)) return { ok: false, error: "Something is missing — please start again." };
  const pwProblem = passwordProblem(password);
  if (pwProblem) return { ok: false, error: pwProblem };

  // Verify the WhatsApp code first — no account until the phone is proven.
  const check = await verifyPhoneOtp(null, mobile, code);
  if (!check.ok) {
    const msg: Record<string, string> = {
      wrong: "That code is not right — check the WhatsApp message and try again.",
      expired: "That code has expired — please ask for a fresh one.",
      no_code: "No code was sent to that number — please request one first.",
      too_many: "Too many wrong tries — please ask for a fresh code.",
      bad_number: "That mobile number does not look right.",
    };
    return { ok: false, error: msg[check.reason] ?? "Could not verify that code." };
  }

  const svc = createServiceClient();
  // Create the account WITH their password. email_confirm:true so they can sign
  // in immediately even though we have not verified the email yet — that is
  // tracked separately by profiles.email_verified_at (left null here).
  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !created?.user) {
    const m = (error?.message || "").toLowerCase();
    if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
      return { ok: false, error: "An account with this email already exists. Please log in instead." };
    }
    return { ok: false, error: error?.message || "Could not create the account. Please try again." };
  }

  const userId = created.user.id;
  const phoneE164 = toE164(mobile);
  // Stamp the profile: name, the proven phone, and phone_verified_at. The
  // handle_new_user trigger creates the row; this fills the rest.
  await svc.from("profiles").update({
    full_name: name || null,
    phone: mobile,
    phone_e164: phoneE164,
    phone_verified_at: new Date().toISOString(),
    email_verified_at: null,
  }).eq("id", userId);

  // Send the email-verification link (best-effort — it must not block the
  // account they already have). Clicking it clears the nag banner.
  if (await emailConfigured()) {
    try {
      const { data: link } = await svc.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = link?.properties?.hashed_token;
      if (tokenHash) {
        const url = `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/dashboard`;
        await sendTemplate("email_verify", email, {
          name: name || "there",
          heading: "Verify your email",
          action_url: url,
          action_label: "Verify my email",
        });
      }
    } catch { /* the account stands even if the email hiccups */ }
  }

  return { ok: true, email };
}
