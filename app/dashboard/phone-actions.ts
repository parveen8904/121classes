"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendPhoneOtp, verifyPhoneOtp } from "@/lib/phoneVerify";

// The student-facing half of phone verification. Both actions are scoped to
// the signed-in user: a code can only ever be sent for, and verified against,
// the caller's own account.

export type PhoneState = { error?: string; sent?: boolean; done?: boolean; phone?: string };

const SEND_ERRORS: Record<string, string> = {
  bad_number: "That doesn't look like a valid mobile number. Please check and try again.",
  cooldown: "A code was just sent. Please wait a minute before asking for another.",
  not_ready: "WhatsApp verification isn't available right now. Please try again a little later.",
  send_failed: "We couldn't send the code just now. Please try again in a few minutes.",
};

const CHECK_ERRORS: Record<string, string> = {
  bad_number: "That number doesn't look right.",
  no_code: "No code was sent to this number. Please request one first.",
  expired: "That code has expired. Ask for a new one.",
  too_many: "Too many wrong attempts. Request a fresh code.",
  wrong: "That code doesn't match. Please check and try again.",
};

export async function sendPhoneCode(_prev: PhoneState, formData: FormData): Promise<PhoneState> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const phone = String(formData.get("phone") ?? "").trim();
  const r = await sendPhoneOtp(user.id, phone);
  if (!r.ok) return { error: SEND_ERRORS[r.reason] ?? SEND_ERRORS.send_failed, phone };
  return { sent: true, phone };
}

export async function checkPhoneCode(_prev: PhoneState, formData: FormData): Promise<PhoneState> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const phone = String(formData.get("phone") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const r = await verifyPhoneOtp(user.id, phone, code);
  if (!r.ok) return { error: CHECK_ERRORS[r.reason] ?? CHECK_ERRORS.wrong, sent: true, phone };

  revalidatePath("/dashboard");
  return { done: true, phone };
}
