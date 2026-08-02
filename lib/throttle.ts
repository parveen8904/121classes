import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";

// Rate limiting for the handful of endpoints that a stranger can call and that
// COST something — registration and password reset each send an email. Without
// this, one script could burn the Mailgun quota, and the first casualty would
// be real students unable to reset their passwords.
//
// Deliberately fails OPEN: if the limiter itself errors we let the request
// through rather than locking students out of their own accounts.

/** The caller's IP, as far as Vercel can tell. "unknown" if it cannot. */
export async function callerIp(): Promise<string> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for") ?? "";
    return fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Take one token from `bucket`. Returns true when the caller may proceed.
 * @param limit   how many are allowed in the window
 * @param seconds length of the window
 */
export async function allow(bucket: string, limit: number, seconds: number): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc("rate_take", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: seconds,
    });
    if (error) return true; // fail open
    return data !== false;
  } catch {
    return true; // fail open
  }
}

/**
 * Guard an email-sending action by BOTH the caller's IP and the address typed.
 * The per-address limit stops someone being mail-bombed; the per-IP limit stops
 * one script working through a list of addresses.
 */
export async function allowEmailAction(
  action: string,
  email: string,
  opts: { perEmail: number; perIp: number; seconds: number },
): Promise<boolean> {
  const ip = await callerIp();
  const [okEmail, okIp] = await Promise.all([
    allow(`${action}:email:${email.toLowerCase()}`, opts.perEmail, opts.seconds),
    allow(`${action}:ip:${ip}`, opts.perIp, opts.seconds),
  ]);
  return okEmail && okIp;
}
