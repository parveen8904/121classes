import { createServiceClient } from "@/lib/supabase/service";
import { emailShell } from "@/lib/notify";

// The email a student gets when access is granted by hand.
//
// It used to be three sentences buried in the enrolment action, which was fine
// for "here is the course you paid for" and wrong for what it is mostly used
// for now: inviting past students back to look at the rebuilt site and say what
// they think. So the wording lives in settings and is edited on the enrolment
// page — no deploy needed to change how it reads.

export const GRANT_SUBJECT_KEY = "grant_email_subject";
export const GRANT_BODY_KEY = "grant_email_body";

export const DEFAULT_GRANT_SUBJECT = "A complimentary {{months}}-month look at the new caparveensharma.com";

// Plain text with {{placeholders}}; blank lines separate paragraphs.
export const DEFAULT_GRANT_BODY = `Dear {{name}},

You have studied with me before, which is exactly why I would like your eyes on this.

We have rebuilt caparveensharma.com from the ground up. Alongside the recorded classes there is now a day-by-day study planner that works backwards from your attempt, chapter tests that tell you which concepts to go back over, case-scenario practice for the new exam pattern, and a doubt assistant that answers from our own class material.

I have opened {{course}} for you — {{tier}} access, free, until {{expires}}. There is nothing to pay and nothing to cancel; it simply ends on that date.

What I would really value in return is your honest opinion. Use it for a week the way a student would, and then tell me what felt clumsy, what you expected to find and could not, and what you would not bother with at all. Simply reply to this email, or write to us at caparveensharma.com/support.

Two practical notes: printed books are not part of a complimentary subscription — you can order those at caparveensharma.com/books if you want them — and you log in with this email address.

Thank you for helping shape what we build next.

CA Parveen Sharma`;

export type GrantVars = {
  name: string;
  course: string;
  tier: string;
  months: number;
  expires: string;
};

function fill(text: string, v: GrantVars): string {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, v.name)
    .replace(/\{\{\s*course\s*\}\}/gi, v.course)
    .replace(/\{\{\s*tier\s*\}\}/gi, v.tier)
    .replace(/\{\{\s*months\s*\}\}/gi, String(v.months))
    .replace(/\{\{\s*expires\s*\}\}/gi, v.expires);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Plain paragraphs, and bare links made clickable — so the founder can write
// the email as text without knowing any HTML.
function toHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((para) => {
      // Trailing punctuation must stay OUTSIDE the link — "…/support." linked
      // with the full stop attached, which is a broken address.
      const withLinks = esc(para.trim())
        .replace(/\b(caparveensharma\.com[^\s<]*?)([.,;:!?)]*)(?=\s|$)/g, '<a href="https://$1">$1</a>$2')
        .replace(/\n/g, "<br />");
      return `<p>${withLinks}</p>`;
    })
    .join("\n");
}

export async function loadGrantTemplate(): Promise<{ subject: string; body: string }> {
  try {
    const { data } = await createServiceClient()
      .from("site_settings")
      .select("key, value")
      .in("key", [GRANT_SUBJECT_KEY, GRANT_BODY_KEY]);
    const m = new Map((data ?? []).map((r) => [r.key as string, (r.value as string) ?? ""]));
    return {
      subject: (m.get(GRANT_SUBJECT_KEY) || "").trim() || DEFAULT_GRANT_SUBJECT,
      body: (m.get(GRANT_BODY_KEY) || "").trim() || DEFAULT_GRANT_BODY,
    };
  } catch {
    return { subject: DEFAULT_GRANT_SUBJECT, body: DEFAULT_GRANT_BODY };
  }
}

// Build the email for one student. `template` is passed in so a bulk grant
// loads the wording once rather than once per recipient.
export function buildGrantEmail(
  template: { subject: string; body: string },
  vars: GrantVars,
): { subject: string; html: string } {
  const subject = fill(template.subject, vars);
  return {
    subject,
    html: emailShell(subject, toHtml(fill(template.body, vars))),
  };
}
