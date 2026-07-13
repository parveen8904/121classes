import { createHmac } from "node:crypto";

// "Remember this device for 30 days" for admin two-factor. After a successful
// authenticator check we drop a signed, httpOnly cookie tying THIS browser to
// the admin for 30 days; while it's valid the admin skips the 6-digit code.
// Signed with the service-role key (server-only secret) so it can't be forged.
const COOKIE = "mfa_trusted";
const DAYS = 30;

function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "fallback-mfa-secret";
}

function sign(userId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${userId}.${exp}`).digest("hex");
}

// The cookie VALUE to store (exp.signature). Cookie name is exported too.
export function trustedCookie(userId: string): { name: string; value: string; maxAge: number } {
  const exp = Date.now() + DAYS * 24 * 3600 * 1000;
  return { name: COOKIE, value: `${exp}.${sign(userId, exp)}`, maxAge: DAYS * 24 * 3600 };
}

export const TRUSTED_COOKIE = COOKIE;

// True if the cookie is a valid, unexpired trust token for this admin.
export function isTrusted(cookieValue: string | undefined, userId: string): boolean {
  if (!cookieValue) return false;
  const [expStr, sig] = cookieValue.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  return sign(userId, exp) === sig;
}
