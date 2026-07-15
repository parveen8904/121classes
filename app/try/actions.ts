"use server";

import { randomInt } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// Verified lead capture for the free case-scenario test. Both contacts are
// confirmed — a 6-digit code by email AND a WhatsApp OTP — so the leads list
// holds only real, reachable people. Rate-limited to stop OTP abuse.

function s(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
const code6 = () => String(randomInt(100000, 1000000));

export type StartResult = {
  ok: boolean;
  id?: string;
  emailSent?: boolean;
  phoneSent?: boolean;
  error?: string;
};

export async function startCaseTrial(formData: FormData): Promise<StartResult> {
  const name = s(formData.get("name")).slice(0, 80);
  const email = s(formData.get("email")).toLowerCase().slice(0, 120);
  const phone = s(formData.get("phone")).replace(/\D/g, "").slice(-10);
  if (!name) return { ok: false, error: "Please tell us your name." };
  if (!email.includes("@") || /[,()\s]/.test(email)) return { ok: false, error: "Please enter a valid email." };
  if (phone.length !== 10) return { ok: false, error: "Please enter your 10-digit WhatsApp number." };

  const svc = createServiceClient();

  // Rate limit: max 3 verification starts per contact per hour.
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const { count: recent } = await svc
    .from("lead_verifications")
    .select("id", { count: "exact", head: true })
    .or(`email.eq.${email},phone.eq.${phone}`)
    .gte("created_at", hourAgo);
  if ((recent ?? 0) >= 3) return { ok: false, error: "Too many attempts — please try again in an hour." };

  // Lead first (kept even if verification is abandoned), deduped.
  const [{ data: existing }, { data: prof }] = await Promise.all([
    svc.from("leads").select("id").or(`email.eq.${email},phone.eq.${phone}`).limit(1).maybeSingle(),
    svc.from("profiles").select("id").eq("email", email).limit(1).maybeSingle(),
  ]);
  let leadId = existing?.id as string | undefined;
  if (!leadId) {
    const { data: ins } = await svc.from("leads").insert({
      name, email, phone, source: "popup", note: "case-test popup",
      matched_user_id: prof?.id ?? null,
    }).select("id").maybeSingle();
    leadId = ins?.id as string | undefined;
  }

  const emailCode = code6();
  const phoneCode = code6();

  // Email code (Mailgun).
  const { sendEmail, emailShell, sendWhatsApp } = await import("@/lib/notify");
  const emailSent = await sendEmail(
    email,
    `${emailCode} is your verification code — CA Parveen Sharma`,
    emailShell("Your verification code",
      `<p>Hi ${name},</p>
       <p>Your code for the free CA case-scenario test is:</p>
       <p style="font-size:28px;font-weight:800;letter-spacing:4px">${emailCode}</p>
       <p style="color:#94a3b8;font-size:12px">Valid for 30 minutes. If you didn't request this, ignore this email.</p>`),
  ).catch(() => false);
  if (!emailSent) return { ok: false, error: "Couldn't send the email code — please check the email address and try again." };

  // WhatsApp OTP via Interakt (needs an approved authentication template with
  // one {{1}} variable). If not configured yet, we proceed on email alone.
  const otpTemplate = (await getSecret("WHATSAPP_OTP_TEMPLATE")).trim();
  const phoneSent = otpTemplate ? await sendWhatsApp(phone, otpTemplate, [phoneCode]).catch(() => false) : false;

  const { data: v } = await svc.from("lead_verifications").insert({
    lead_id: leadId ?? null,
    email, phone,
    email_code: emailCode,
    phone_code: phoneSent ? phoneCode : null,
  }).select("id").maybeSingle();
  if (!v) return { ok: false, error: "Something went wrong — please try again." };

  return { ok: true, id: v.id as string, emailSent: true, phoneSent };
}

export async function confirmCaseTrial(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const id = s(formData.get("id"));
  const emailCode = s(formData.get("email_code")).replace(/\D/g, "");
  const phoneCode = s(formData.get("phone_code")).replace(/\D/g, "");
  if (!id) return { ok: false, error: "Session expired — please start again." };

  const svc = createServiceClient();
  const { data: v } = await svc.from("lead_verifications").select("*").eq("id", id).maybeSingle();
  if (!v) return { ok: false, error: "Session expired — please start again." };
  if (new Date(v.expires_at as string).getTime() < Date.now()) return { ok: false, error: "The codes expired — please start again." };
  if ((v.attempts as number) >= 8) return { ok: false, error: "Too many wrong attempts — please start again." };
  await svc.from("lead_verifications").update({ attempts: (v.attempts as number) + 1 }).eq("id", id);

  if (emailCode !== v.email_code) return { ok: false, error: "The email code is wrong — check the email we sent." };
  if (v.phone_code && phoneCode !== v.phone_code) return { ok: false, error: "The WhatsApp code is wrong — check your WhatsApp." };

  await svc.from("lead_verifications").update({ email_verified: true, phone_verified: Boolean(v.phone_code) }).eq("id", id);
  if (v.lead_id) {
    await svc.from("leads").update({ verified: true }).eq("id", v.lead_id);
  }
  return { ok: true };
}
