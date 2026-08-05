import { randomInt } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, emailShell } from "@/lib/notify";

// Get the bulk-granted students in.
//
// 1,545 accounts were created from 1 August. 79 have ever signed in. The rest —
// 1,466 students who have been given paid access — cannot get into the site.
//
// Self-registration is fine: before 1 August, five sign-ups a day and nearly all
// of them logged in. The difference is that a bulk-granted student never chose a
// password. They were emailed a "set my password" button, and that button is a
// Supabase recovery token: it is SINGLE USE and it EXPIRES. A student who opens
// the email next morning, or whose mail provider fetched the link to preview it,
// gets "link expired" — and the next thing they do is give up.
//
// A link that must be used within the hour is the wrong instrument for a
// student who reads email once a day. So this sends a PASSWORD instead. It does
// not expire, it works from any device, it can be typed by somebody reading it
// off a phone, and they can change it afterwards from their dashboard.
//
// The account's policy demands a capital, a small letter, a digit and a symbol —
// a generated password that misses one is silently refused, which is how the
// July outage happened. This builds one that cannot miss.

const WORDS = ["Study", "Ledger", "Balance", "Journal", "Profit", "Capital", "Revenue", "Audit"];

/** A password that satisfies the policy and can be read aloud over a phone. */
export function temporaryPassword(): string {
  const word = WORDS[randomInt(WORDS.length)];
  const digits = String(randomInt(1000, 9999));
  return `${word}@${digits}`; // capital, small letters, symbol, digits, 10-12 chars
}

export type RescueResult = { fixed: number; failed: string[]; remaining: number };

/**
 * Give every never-signed-in student a working password and email it to them.
 * Safe to re-run: a student who has since logged in is skipped, and anybody
 * rescued already is skipped too, so nobody's password is changed twice.
 */
export async function sendFirstLoginPasswords(
  limit = 100,
  opts: { onlyThoseWhoTried?: boolean } = {},
): Promise<RescueResult> {
  const svc = createServiceClient();
  const fixed: string[] = [];
  const failed: string[] = [];

  // Students who have an account and have NEVER got in. auth.users is not
  // reachable through PostgREST, so the never-signed-in test comes from the RPC.
  // Two audiences, and they are very different sizes.
  //
  // Only ~253 people have visited the login page at all since the grants began,
  // and page views of a logged-OUT visitor carry no identity, so the ones who
  // tried and failed cannot be named from them. What CAN be named is anyone who
  // asked for a link themselves — their recovery is stamped later than the one
  // sent when the account was made. That is a person who has actively tried.
  const rpc = opts.onlyThoseWhoTried ? "students_who_tried_to_get_in" : "students_never_signed_in";
  const { data: rows, error } = await svc.rpc(rpc, { max_rows: limit });
  if (error) return { fixed: 0, failed: [`could not list them: ${error.message}`], remaining: -1 };

  for (const r of (rows ?? []) as { id: string; email: string; full_name: string | null }[]) {
    const password = temporaryPassword();
    try {
      const { error: pwErr } = await svc.auth.admin.updateUserById(r.id, { password });
      if (pwErr) { failed.push(`${r.email}: ${pwErr.message}`); continue; }

      const name = String(r.full_name ?? "").trim().split(/\s+/)[0] || "there";
      const ok = await sendEmail(
        r.email,
        "Your login for CA Parveen Sharma Classes",
        emailShell(
          "Here is your login",
          `<p>Hello ${name},</p>
           <p>Your account is ready. Log in at <a href="https://caparveensharma.com/login">caparveensharma.com/login</a> with:</p>
           <p><strong>Email:</strong> ${r.email}<br/>
              <strong>Password:</strong> <span style="font-family:ui-monospace,monospace;font-size:1.15rem;font-weight:700">${password}</span></p>
           <p>This password does not expire. Change it whenever you like from your dashboard.</p>
           <p>If an earlier email gave you a "Set my password" button that said the link had expired — that is why this
              one has the password itself instead. Nothing is wrong with your account.</p>`,
        ),
        { important: true },
      );
      if (!ok) { failed.push(`${r.email}: email did not send`); continue; }

      // Only once BOTH the password is set and the email has gone.
      await svc.from("profiles").update({ has_password: true }).eq("id", r.id);
      fixed.push(r.email);
    } catch (e) {
      failed.push(`${r.email}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  const { data: leftRows } = await svc.rpc(rpc, { max_rows: 1000 });
  return { fixed: fixed.length, failed, remaining: ((leftRows ?? []) as unknown[]).length };
}
