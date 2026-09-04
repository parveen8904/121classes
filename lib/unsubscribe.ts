import crypto from "crypto";
import { getSecret } from "@/lib/secrets";

// AN UNSUBSCRIBE LINK NOBODY CAN AIM AT SOMEBODY ELSE.
//
// "Where is the unsubscribe option?" — the founder, 4 September 2026, after a
// student had received nine emails he never asked for and could do nothing
// about but reply angrily.
//
// The address travels in the link, so the link has to prove it was issued by
// us: without a signature, anyone could unsubscribe any student by editing a
// query string, and a competitor could unsubscribe the whole register. The
// token is an HMAC of the address, so a changed address makes a token that
// does not verify.
//
// Deliberately NOT time-limited. An unsubscribe link found in a six-month-old
// email must still work — the whole point is that leaving is always possible,
// and "your link has expired" is how a person ends up marking mail as spam
// instead, which costs every other student their password email.

async function key(): Promise<string> {
  // Its own secret where one is set; otherwise the cron secret, which exists
  // in every environment this runs in. Both are server-only.
  return (await getSecret("UNSUBSCRIBE_SECRET")) || (await getSecret("CRON_SECRET")) || "";
}

const norm = (email: string) => String(email ?? "").trim().toLowerCase();

export async function unsubscribeToken(email: string): Promise<string> {
  const k = await key();
  if (!k) return "";
  return crypto.createHmac("sha256", k).update(norm(email)).digest("hex").slice(0, 32);
}

/** True only for a token this site issued for this exact address. */
export async function unsubscribeTokenValid(email: string, token: string): Promise<boolean> {
  const want = await unsubscribeToken(email);
  if (!want || !token || want.length !== token.length) return false;
  // Constant-time: comparing with === leaks how much of the token was right.
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(token));
}

const siteBase = () => process.env.NEXT_PUBLIC_SITE_URL || "https://caparveensharma.com";

/** The link a PERSON clicks — lands on a page that asks before it acts. */
export async function unsubscribeUrl(email: string): Promise<string> {
  const t = await unsubscribeToken(email);
  if (!t) return "";
  return `${siteBase()}/unsubscribe?e=${encodeURIComponent(norm(email))}&t=${t}`;
}

/**
 * The address Gmail and Outlook POST to when the reader presses THEIR
 * "Unsubscribe" button beside the sender's name.
 *
 * A separate path from the page above, because one-click has to act on a POST
 * with no page in between, and the page must NOT act on a GET — mail scanners
 * follow every link in a message, and a GET that unsubscribed would remove
 * people who never clicked anything.
 */
export async function unsubscribePostUrl(email: string): Promise<string> {
  const t = await unsubscribeToken(email);
  if (!t) return "";
  return `${siteBase()}/api/unsubscribe?e=${encodeURIComponent(norm(email))}&t=${t}`;
}
