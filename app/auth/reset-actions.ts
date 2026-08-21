"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { passwordProblem } from "@/lib/passwordRule";
import { sendPhoneOtp, verifyPhoneOtp, toE164, phoneVerifyLive } from "@/lib/phoneVerify";

// RESET A PASSWORD THROUGH THE VERIFIED WHATSAPP NUMBER.
//
// The founder's challenge: a phone-first student who never verified their email
// (or mistyped it) forgets their password — the emailed reset link goes nowhere,
// so they are locked out. But their MOBILE is proven. So they can reset through
// it: a WhatsApp OTP to the number on file, then a new password. No email needed.
//
// Only numbers that were actually verified (phone_verified_at set) can be used,
// and only someone holding that phone can read the code — the same security as
// signing up.

export type ResetSend = { ok: true; hint: string } | { ok: false; error: string };

/** Step 1 — send a WhatsApp code to the verified number on file. */
export async function resetSendOtp(formData: FormData): Promise<ResetSend> {
  const mobile = String(formData.get("phone") || "").trim();
  const e164 = toE164(mobile);
  if (!e164) return { ok: false, error: "Enter the 10-digit mobile number on your account." };
  if (!(await phoneVerifyLive())) {
    return { ok: false, error: "WhatsApp reset is unavailable right now — please use the email reset instead." };
  }

  const svc = createServiceClient();
  const { data: prof } = await svc
    .from("profiles").select("id")
    .eq("phone_e164", e164).not("phone_verified_at", "is", null).maybeSingle();

  // Don't reveal whether a number is registered; only actually send if it is.
  if (prof?.id) {
    const sent = await sendPhoneOtp(String(prof.id), mobile);
    if (!sent.ok && sent.reason === "cooldown") {
      return { ok: false, error: "A code was just sent — please wait a minute before asking for another." };
    }
  }
  return { ok: true, hint: "If that number is on a verified account, we've sent a WhatsApp code to it. Enter the code and choose a new password." };
}

export type ResetDone = { ok: true; email: string } | { ok: false; error: string };

/** Step 2 — check the code and set the new password. */
export async function resetVerifyAndSet(formData: FormData): Promise<ResetDone> {
  const mobile = String(formData.get("phone") || "").trim();
  const code = String(formData.get("code") || "").trim();
  const password = String(formData.get("password") || "");
  const e164 = toE164(mobile);
  if (!e164) return { ok: false, error: "That mobile number does not look right." };
  const pwProblem = passwordProblem(password);
  if (pwProblem) return { ok: false, error: pwProblem };

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
  const { data: prof } = await svc
    .from("profiles").select("id, email")
    .eq("phone_e164", e164).not("phone_verified_at", "is", null).maybeSingle();
  if (!prof?.id || !prof.email) {
    return { ok: false, error: "We couldn't find a verified account for that number. Please use email reset or contact support." };
  }

  const { error } = await svc.auth.admin.updateUserById(String(prof.id), { password });
  if (error) return { ok: false, error: "Couldn't set the new password. Please try again." };

  return { ok: true, email: String(prof.email) };
}
