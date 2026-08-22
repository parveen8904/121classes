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
// Works for ANY account (student or staff) with the mobile on file — verified or
// not, because completing the code (which only reaches the real phone) is itself
// the proof. A number shared by more than one account is declined.

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
  // Any student with this mobile ON FILE — verified or not. Completing the code
  // (which only reaches the real phone) is itself the proof, so a grandfathered
  // student who never verified their number can still recover this way.
  const { data: rows } = await svc
    .from("profiles").select("id").eq("phone_e164", e164);
  const list = rows ?? [];
  if (list.length > 1) {
    // A shared number can't be disambiguated safely — send them to email.
    return { ok: false, error: "This number is linked to more than one account — please reset by email, or contact support." };
  }
  // Don't reveal whether a number is registered; only actually send if it is.
  if (list.length === 1) {
    const sent = await sendPhoneOtp(String(list[0].id), mobile);
    if (!sent.ok && sent.reason === "cooldown") {
      return { ok: false, error: "A code was just sent — please wait a minute before asking for another." };
    }
  }
  return { ok: true, hint: "If that mobile is on an account, we've sent a WhatsApp code to it. Enter the code and choose a new password." };
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
  const { data: rows } = await svc
    .from("profiles").select("id, email").eq("phone_e164", e164);
  const list = rows ?? [];
  if (list.length !== 1 || !list[0].email) {
    return {
      ok: false,
      error: list.length > 1
        ? "This number is linked to more than one account — please reset by email or contact support."
        : "We couldn't find an account for that number. Please use email reset or contact support.",
    };
  }
  const target = list[0];

  const { error } = await svc.auth.admin.updateUserById(String(target.id), { password });
  if (error) return { ok: false, error: "Couldn't set the new password. Please try again." };

  // They just proved the number by reading the code — record it as verified.
  await svc.from("profiles")
    .update({ phone_verified_at: new Date().toISOString() })
    .eq("id", target.id).is("phone_verified_at", null);

  return { ok: true, email: String(target.email) };
}
