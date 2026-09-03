import { createServiceClient } from "@/lib/supabase/service";
import { sendTemplate } from "@/lib/emailTemplates";
import { sendWhatsAppText } from "@/lib/notify";
import { toE164Digits } from "@/lib/phoneNumber";

const SITE_URL = "https://caparveensharma.com";

// Solve a "can't log in" request instead of forwarding it to a human.
//
// Nearly every one of these has the same handful of causes, and the site holds
// the facts needed to settle each: does an account exist for that email, does
// it have a password, is there another account on that phone. So it acts —
// sends the right link by email AND WhatsApp — and only asks a person to step
// in when it genuinely cannot tell.
//
// Deliberately conservative about privacy: an unverified stranger typing an
// email is never TOLD whether that email has an account (that would leak who
// studies here). The link simply goes to the address on file; whoever owns the
// mailbox gets it.

export type RescueOutcome =
  | { handled: true; kind: "reset_sent" | "other_email_hint"; note: string }
  | { handled: false; note: string };

// Same one rule as everywhere else — see lib/phoneNumber.ts.
const e164 = (phone: string): string => toE164Digits(phone);

/**
 * Send whoever owns this address the link that gets them in.
 *
 * One link, one email, one destination. A student who has forgotten their
 * password and a student who was granted access and never chose one both need
 * exactly the same thing — a link that signs them in and lets them set a
 * password — so there is no reason to ask which of the two they are.
 *
 * It is a recovery link underneath, which works whether or not there is a
 * password to recover. (An "invite" link does not: Supabase refuses it for an
 * address that already has an account, which is every one of these students.)
 *
 * Never says whether the address exists. The answer goes to the mailbox.
 */
export async function sendAccessLink(email: string, name?: string): Promise<
  { sent: boolean; note: string }
> {
  const svc = createServiceClient();
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return { sent: false, note: "no email given" };

  const { data } = await svc
    .from("profiles").select("id, email, full_name").ilike("email", addr).maybeSingle();
  const account = data as { id: string; email: string; full_name: string | null } | null;
  if (!account?.email) return { sent: false, note: "no account on that address" };

  const { data: linkData } = await svc.auth.admin.generateLink({ type: "recovery", email: account.email } as never);
  const tokenHash = (linkData as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
  if (!tokenHash) return { sent: false, note: "could not generate a link" };

  const url = `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/auth/set-password`;
  const ok = await sendTemplate("password_reset", account.email, {
    heading: "Choose your password",
    action_url: url,
    action_label: "Choose my password",
    name: name || account.full_name || "",
  });

  return { sent: !!ok, note: ok ? `link emailed to ${maskEmail(account.email)}` : "the email could not be sent" };
}

export async function rescueLogin(input: {
  name?: string;
  phone: string;
  email?: string;
}): Promise<RescueOutcome> {
  const svc = createServiceClient();
  const email = (input.email ?? "").trim().toLowerCase();
  const phoneDigits = (input.phone ?? "").replace(/\D/g, "").slice(-10);
  const firstName = (input.name ?? "").trim().split(/\s+/)[0] || "there";

  // 1) The email they typed.
  type Account = { id: string; email: string };
  let account: Account | null = null;
  if (email) {
    const { data } = await svc
      .from("profiles")
      .select("id, email")
      .ilike("email", email)
      .maybeSingle();
    account = (data as unknown as Account) ?? null;
  }

  // 2) No account on that email — but perhaps they signed up with another one
  //    and the phone matches. That is the single most common cause.
  let otherEmail: string | null = null;
  if (!account && phoneDigits.length === 10) {
    const { data } = await svc
      .from("profiles")
      .select("email")
      .like("phone", `%${phoneDigits}%`)
      .limit(1)
      .maybeSingle();
    otherEmail = (data as { email?: string } | null)?.email ?? null;
  }

  const wa = e164(input.phone);

  // Did they already get in by themselves between asking and now? Three of
  // the six requests sitting open were exactly this — the student solved it
  // in a minute and the row was never closed, so a person kept being paged
  // about someone who was fine.
  if (account?.id) {
    const { data: u } = await svc.auth.admin.getUserById(account.id);
    const lastSignIn = u?.user?.last_sign_in_at ? new Date(u.user.last_sign_in_at).getTime() : 0;
    if (lastSignIn && Date.now() - lastSignIn < 10 * 60_000) {
      return { handled: true, kind: "reset_sent", note: "student signed in on their own just now — nothing to do" };
    }
  }

  // Case A / B — the account exists. Send the one link that gets anybody in,
  // and tell them on WhatsApp that it is coming.
  if (account?.email) {
    const r = await sendAccessLink(account.email, input.name);
    if (!r.sent) return { handled: false, note: r.note };

    if (wa.length >= 11) {
      await sendWhatsAppText(
        wa,
        `Hello ${firstName}, this is CA Parveen Sharma Classes.\n\n` +
          `We have sent a sign-in link to your registered email (${maskEmail(account.email)}). ` +
          `Open it, choose your password, and you are back in within a minute.\n\n` +
          `Please check the spam folder too. If it still does not work, reply here and a person will help you.`,
      ).catch(() => false);
    }

    return {
      handled: true,
      kind: "reset_sent",
      note: `Account found (${maskEmail(account.email)}) — ${r.note}${wa.length >= 11 ? " and WhatsApp sent" : ""}.`,
    };
  }

  // Case C — nothing on that email, but the phone matches another account.
  if (otherEmail) {
    if (wa.length >= 11) {
      await sendWhatsAppText(
        wa,
        `Hello ${firstName}, this is CA Parveen Sharma Classes.\n\n` +
          `Your account is registered on a different email — ${maskEmail(otherEmail)}. Please sign in with that one.\n\n` +
          `If you cannot open that mailbox, reply here and we will sort it out.`,
      ).catch(() => false);
      return {
        handled: true,
        kind: "other_email_hint",
        note: `No account on the email tried; phone matches ${maskEmail(otherEmail)} — told them on WhatsApp.`,
      };
    }
    return { handled: false, note: `phone matches ${maskEmail(otherEmail)} but no WhatsApp number to reply on` };
  }

  // Case D — nothing on file at all. TEN OF THE TWENTY-EIGHT PEOPLE who asked
  // for help logging in were this: they had never registered. They were not
  // locked out of anything; they were standing outside a door they had not yet
  // been given, because the app and the site both open on "Log in".
  //
  // This used to page a person to ring them back, which is the slowest possible
  // way to say "please tap Create account". So it says it, at once, on both
  // channels we have — and only troubles somebody if we cannot even do that.
  {
    const how =
      `you are not registered on the portal yet, which is why no password worked. ` +
      `Open caparveensharma.com, tap "Create account", and enter this email address. ` +
      `You will get an email straight away — opening it lets you choose your password and takes you in. ` +
      `It takes about a minute.`;

    let told = false;
    if (email) {
      told = await sendTemplate("login_help", email, { name: firstName }).catch(() => false);
    }
    if (wa.length >= 11) {
      await sendWhatsAppText(
        wa,
        `Hello ${firstName}, this is CA Parveen Sharma Classes.\n\nWe checked and ${how}\n\n` +
          `If you think you registered with a different email, reply here and we will find it.`,
      ).then((ok) => { told = told || ok; }).catch(() => {});
    }

    if (told) {
      return {
        handled: true,
        kind: "other_email_hint",
        note: "No account on that email or phone — told them how to register, by email and WhatsApp.",
      };
    }
  }

  // Could not even reach them. Now it is a person's job.
  return { handled: false, note: "no account found on that email or phone, and we could not reach them — needs a person" };
}

function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  if (!d) return e;
  const head = u.slice(0, 2);
  return `${head}${"•".repeat(Math.max(2, u.length - 2))}@${d}`;
}
