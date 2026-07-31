import { createHash, randomInt } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsApp } from "@/lib/notify";

// Student phone verification over WhatsApp.
//
// profiles.phone was always free text typed at signup — never proved. Here a
// code is sent to the number, and only a correct answer writes
// phone_verified_at. Codes live hashed in phone_otps so a leaked table hands
// over nothing usable.
//
// The OTP itself rides Meta's AUTHENTICATION template (login_otp). That
// category stays locked until Meta finishes verifying the business, so
// sendPhoneOtp reports a clear "not_ready" instead of pretending to send.

const OTP_TEMPLATE = "login_otp";
const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/** 10-digit Indian numbers gain 91; longer input is assumed to carry a code. */
export function toE164(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10 && digits.length <= 15) return digits;
  return "";
}

function hash(code: string, phone: string): string {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

export type OtpSendResult =
  | { ok: true }
  | { ok: false; reason: "bad_number" | "cooldown" | "not_ready" | "send_failed" };

export async function sendPhoneOtp(userId: string | null, phoneRaw: string): Promise<OtpSendResult> {
  const phone = toE164(phoneRaw);
  if (!phone) return { ok: false, reason: "bad_number" };

  const svc = createServiceClient();

  // One code per minute per number — a resend button cannot be turned into a
  // way to spam someone else's phone.
  const { data: recent } = await svc
    .from("phone_otps")
    .select("sent_at")
    .eq("phone_e164", phone)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent?.sent_at && Date.now() - new Date(recent.sent_at as string).getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    return { ok: false, reason: "cooldown" };
  }

  const code = String(randomInt(100000, 1000000));
  const expires = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  await svc.from("phone_otps").insert({
    user_id: userId,
    phone_e164: phone,
    code_hash: hash(code, phone),
    expires_at: expires,
  });

  // The authentication template carries the code twice: once in the body and
  // once as the copy-code button's payload.
  const sent = await sendWhatsApp(phone, OTP_TEMPLATE, [code], {
    buttonSubType: "url",
    buttonIndex: "0",
    buttonParam: code,
  });
  if (!sent) return { ok: false, reason: "not_ready" };
  return { ok: true };
}

export type OtpCheckResult = { ok: true } | { ok: false; reason: "bad_number" | "no_code" | "expired" | "too_many" | "wrong" };

export async function verifyPhoneOtp(userId: string | null, phoneRaw: string, code: string): Promise<OtpCheckResult> {
  const phone = toE164(phoneRaw);
  if (!phone) return { ok: false, reason: "bad_number" };
  const svc = createServiceClient();

  const { data: row } = await svc
    .from("phone_otps")
    .select("id, code_hash, expires_at, attempts, consumed_at")
    .eq("phone_e164", phone)
    .is("consumed_at", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return { ok: false, reason: "no_code" };
  if (new Date(row.expires_at as string).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if ((row.attempts as number) >= MAX_ATTEMPTS) return { ok: false, reason: "too_many" };

  if (hash(code.trim(), phone) !== row.code_hash) {
    await svc.from("phone_otps").update({ attempts: (row.attempts as number) + 1 }).eq("id", row.id);
    return { ok: false, reason: "wrong" };
  }

  await svc.from("phone_otps").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
  if (userId) {
    await svc
      .from("profiles")
      .update({ phone_e164: phone, phone_verified_at: new Date().toISOString() })
      .eq("id", userId);
  }
  return { ok: true };
}

export async function isPhoneVerified(userId: string): Promise<boolean> {
  const { data } = await createServiceClient()
    .from("profiles")
    .select("phone_verified_at")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(data?.phone_verified_at);
}
