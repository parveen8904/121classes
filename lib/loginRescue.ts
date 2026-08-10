import { createServiceClient } from "@/lib/supabase/service";
import { sendTemplate } from "@/lib/emailTemplates";
import { sendWhatsAppText } from "@/lib/notify";

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
  | { handled: true; kind: "reset_sent" | "set_password_sent" | "other_email_hint"; note: string }
  | { handled: false; note: string };

function e164(phone: string): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
}

/**
 * Send whoever owns this address the link that will actually get them in.
 *
 * Two different links, and which one matters enormously:
 *   • an account with no password yet — 1,659 of them, granted access in bulk
 *     and never asked to choose one — gets "set your password";
 *   • an account with a password gets "reset your password".
 *
 * Both are recovery links underneath, because a recovery link works whether or
 * not there is a password to recover. An "invite" link does not: Supabase
 * refuses it for an address that already has an account, which is every single
 * one of these students.
 *
 * Returns what was sent so the caller can say something true on the screen.
 * Never says whether the address exists — the answer goes to the mailbox.
 */
export async function sendAccessLink(email: string, name?: string): Promise<
  { sent: boolean; kind: "set_password" | "reset" | "none"; note: string }
> {
  const svc = createServiceClient();
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return { sent: false, kind: "none", note: "no email given" };

  const { data } = await svc
    .from("profiles")
    .select("id, email, full_name, has_password")
    .ilike("email", addr)
    .maybeSingle();
  const account = data as { id: string; email: string; full_name: string | null; has_password: boolean | null } | null;
  if (!account?.email) return { sent: false, kind: "none", note: "no account on that address" };

  const needsPassword = account.has_password === false;
  const { data: linkData } = await svc.auth.admin.generateLink({ type: "recovery", email: account.email } as never);
  const tokenHash = (linkData as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
  if (!tokenHash) return { sent: false, kind: "none", note: "could not generate a link" };

  const next = needsPassword ? "/auth/set-password" : "/auth/reset-password";
  const url = `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=recovery&next=${next}`;
  const ok = await sendTemplate(needsPassword ? "account_created" : "password_reset", account.email, {
    heading: needsPassword ? "Set your password" : "Reset your password",
    action_url: url,
    action_label: needsPassword ? "Set my password" : "Reset my password",
    name: name || account.full_name || "",
  });

  return {
    sent: !!ok,
    kind: needsPassword ? "set_password" : "reset",
    note: ok
      ? `${needsPassword ? "set-password" : "reset"} link emailed to ${maskEmail(account.email)}`
      : "the email could not be sent",
  };
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
  type Account = { id: string; email: string; has_password: boolean | null };
  let account: Account | null = null;
  if (email) {
    const { data } = await svc
      .from("profiles")
      .select("id, email, has_password")
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

  // Case A / B — the account exists. Send the right link to the address on
  // file, and tell them on WhatsApp that it is coming.
  if (account?.email) {
    const needsPassword = account.has_password === false;
    // ALWAYS "recovery", never "invite".
    //
    // generateLink with type "invite" is for creating a NEW user; on an address
    // that already has an account Supabase refuses it. Every bulk-granted
    // student has an account and no password — precisely the people who ask for
    // login help — so this branch failed for exactly the students it existed to
    // rescue, and reported "could not generate a sign-in link" with no reason.
    // A recovery link works whether or not there is a password to recover: it
    // signs them in and lets them set one.
    const type = "recovery";
    const next = needsPassword ? "/auth/set-password" : "/auth/reset-password";
    const { data: linkData } = await svc.auth.admin.generateLink({ type, email: account.email } as never);
    const tokenHash = (linkData as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
    if (!tokenHash) {
      console.error("[login_rescue] no link for", account.email, JSON.stringify(linkData)?.slice(0, 200));
      return { handled: false, note: "could not generate a sign-in link" };
    }

    const url = `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=${type}&next=${next}`;
    await sendTemplate(needsPassword ? "account_created" : "password_reset", account.email, {
      heading: needsPassword ? "Set your password" : "Reset your password",
      action_url: url,
      action_label: needsPassword ? "Set my password" : "Reset my password",
      name: input.name ?? "",
    });

    if (wa.length >= 11) {
      await sendWhatsAppText(
        wa,
        `Hello ${firstName}, this is CA Parveen Sharma Classes.\n\n` +
          `We have sent a ${needsPassword ? "set-password" : "password reset"} link to your registered email (${maskEmail(account.email)}). ` +
          `Open it and you will be back in within a minute.\n\n` +
          `Please check the spam folder too. If it still does not work, reply here and a person will help you.`,
      ).catch(() => false);
    }

    return {
      handled: true,
      kind: needsPassword ? "set_password_sent" : "reset_sent",
      note: `Account found (${maskEmail(account.email)}) — ${needsPassword ? "set-password" : "reset"} link emailed${wa.length >= 11 ? " and WhatsApp sent" : ""}.`,
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

  // Case D — genuinely nothing on file. A person should look: they may have
  // bought through Aldine, or used an email they no longer remember.
  return { handled: false, note: "no account found on that email or phone — needs a person" };
}

function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  if (!d) return e;
  const head = u.slice(0, 2);
  return `${head}${"•".repeat(Math.max(2, u.length - 2))}@${d}`;
}
