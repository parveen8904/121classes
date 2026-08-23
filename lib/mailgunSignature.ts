import { createHmac, timingSafeEqual } from "node:crypto";
import { getSecret } from "@/lib/secrets";

/**
 * Mailgun signs every inbound post; an unsigned one is somebody else's.
 *
 * The signing key is NOT the sending key we post mail with — verifying against
 * the sending key rejects every genuine message as a forgery, which is exactly
 * the bug that once silently 401'd the whole bridge. Signing key first, old
 * name only as a fallback for setups that never split them.
 */
export async function verifyMailgunSignature(form: FormData): Promise<boolean> {
  const key = (await getSecret("MAILGUN_WEBHOOK_KEY")) || (await getSecret("MAILGUN_API_KEY"));
  if (!key) return false;
  const timestamp = String(form.get("timestamp") ?? "");
  const token = String(form.get("token") ?? "");
  const signature = String(form.get("signature") ?? "");
  if (!timestamp || !token || !signature) return false;
  // Refuse anything more than 5 minutes old — a captured post cannot be replayed.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", key).update(timestamp + token).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
