import { createServiceClient } from "@/lib/supabase/service";
import { emailShell, sendEmail, sendEmailWithAttachment, type EmailAttachment } from "@/lib/notify";

// Every email the site sends, in one place.
//
// The wording used to be HTML strings scattered through a dozen action files,
// so changing a sentence meant a developer and a deploy. Now each EVENT has a
// template — a subject and a plain-text body — editable at /admin/emails. The
// defaults below are the fallback: if the table has no row for an event (or
// the row is blank), the default is used, so nothing can end up sending an
// empty email.
//
// The body is deliberately NOT HTML. Whoever writes it types sentences; blank
// lines make paragraphs, **stars** make bold, and {{placeholders}} fill in.
// Links are the important part: a login or reset address is a long one-time
// token, and pasting one into an email is both ugly and unsafe — a scanner
// that follows it burns the token before the student clicks. So an action
// address NEVER appears as text. It is attached to a button, and the button is
// placed with {{button}}.

export type Placeholder = { key: string; note: string };

export type EmailEventDef = {
  key: string;
  label: string;
  when: string;
  group: "Account & login" | "Access" | "Offers" | "Support" | "Classes";
  subject: string;
  body: string;
  vars: Placeholder[];
  /** Sample values, used for the preview on the admin page. */
  sample: Record<string, string>;
};

const NAME: Placeholder = { key: "name", note: "the person's name" };
const BUTTON = (label: string): Placeholder => ({ key: "button", note: `the ${label} button (put it on a line of its own)` });

export const EMAIL_EVENTS: EmailEventDef[] = [
  // ── Account & login ───────────────────────────────────────────────────────
  {
    key: "account_created",
    label: "We created their account",
    when: "An admin adds a student in Admin → Users. They have no password yet.",
    group: "Account & login",
    subject: "Your CA Parveen Sharma account is ready",
    body: `Hi {{name}},

An account has been created for you at CA Parveen Sharma. Choose a password and you are in:

{{button}}

Afterwards you log in with this email address and the password you chose.`,
    vars: [NAME, BUTTON("set-password")],
    sample: { name: "Ravi" },
  },
  {
    key: "email_verify",
    label: "Verify a new sign-up",
    when: "Somebody registers on the site.",
    group: "Account & login",
    subject: "Verify your email — CA Parveen Sharma",
    body: `Hi {{name}},

Welcome to CA Parveen Sharma classes. Please confirm your email to activate your account:

{{button}}

After verifying you will choose your password — then you are in.

Didn't sign up? You can safely ignore this email.`,
    vars: [NAME, BUTTON("verify")],
    sample: { name: "Ravi" },
  },
  {
    key: "email_verify_resend",
    label: "Send the verification link again",
    when: 'A student presses "resend" because the first email did not arrive.',
    group: "Account & login",
    subject: "Verify your email — CA Parveen Sharma",
    body: `Here is your link again. It verifies your email and signs you in:

{{button}}`,
    vars: [BUTTON("verify & sign in")],
    sample: {},
  },
  {
    key: "password_reset",
    label: "Forgot password",
    when: 'Somebody uses "forgot password" on the login page.',
    group: "Account & login",
    subject: "Reset your password — CA Parveen Sharma",
    body: `We received a request to reset the password on your CA Parveen Sharma account.

{{button}}

If you didn't ask for this, you can ignore this email — your password stays as it is.`,
    vars: [BUTTON("set a new password")],
    sample: {},
  },

  // ── Access ────────────────────────────────────────────────────────────────
  {
    key: "access_granted",
    label: "You granted access by hand",
    when: "You give somebody a subscription in Admin → Enrolment — complimentary access, a replacement, or a course bought offline.",
    group: "Access",
    subject: "A complimentary {{months}}-month look at the new caparveensharma.com",
    body: `Dear {{name}},

You have studied with me before, which is exactly why I would like your eyes on this.

We have rebuilt caparveensharma.com from the ground up. Alongside the recorded classes there is now a day-by-day study planner that works backwards from your attempt, chapter tests that tell you which concepts to go back over, case-scenario practice for the new exam pattern, and a doubt assistant that answers from our own class material.

I have opened {{course}} for you — {{tier}} access, free, until {{expires}}. There is nothing to pay and nothing to cancel; it simply ends on that date.

What I would really value in return is your honest opinion. Use it for a week the way a student would, and then tell me what felt clumsy, what you expected to find and could not, and what you would not bother with at all. Simply reply to this email, or write to us at caparveensharma.com/support.

Two practical notes: printed books are not part of a complimentary subscription — you can order those at caparveensharma.com/books if you want them — and you log in with this email address.

Thank you for helping shape what we build next.

CA Parveen Sharma`,
    vars: [
      NAME,
      { key: "course", note: "the course or subject you opened" },
      { key: "tier", note: "gold / silver / bronze" },
      { key: "months", note: "how many months" },
      { key: "expires", note: "the last day, as a date — 29 October 2026" },
    ],
    sample: { name: "Ravi", course: "CA Final — Financial Reporting", tier: "gold", months: "3", expires: "29 October 2026" },
  },
  {
    key: "gift_received",
    label: "Somebody gifted them a subscription",
    when: "A sponsor pays for a student through Sponsor-a-Student.",
    group: "Access",
    subject: "🎁 You've received a gift subscription — CA Parveen Sharma",
    body: `Hi {{name}},

Someone has gifted you **{{tier}}** access to **{{course}}** with CA Parveen Sharma for {{months}} months.

Set your password and start learning:

{{button}}

Your login email is **{{email}}**.`,
    vars: [
      NAME,
      { key: "tier", note: "gold / silver / bronze" },
      { key: "course", note: "the subject gifted" },
      { key: "months", note: "how many months" },
      { key: "email", note: "the address they log in with" },
      BUTTON("set-password"),
    ],
    sample: { name: "Ravi", tier: "gold", course: "Financial Reporting", months: "6", email: "ravi@example.com" },
  },

  // ── Offers ────────────────────────────────────────────────────────────────
  {
    key: "coupon_sent",
    label: "A discount coupon",
    when: "You send a coupon to a student from Admin → Coupons.",
    group: "Offers",
    subject: "🎟️ A discount coupon for you — CA Parveen Sharma",
    body: `We'd love to support your CA journey. Use this coupon at checkout:

Your code — **{{code}}** — gives you **{{discount}}**{{validity}}.

Enter it on the payment step when you buy your subscription.

{{button}}`,
    vars: [
      { key: "code", note: "the coupon code" },
      { key: "discount", note: "e.g. 20% off" },
      { key: "validity", note: "e.g. , valid until 30 September" },
      BUTTON("explore courses"),
    ],
    sample: { code: "WELCOME20", discount: "20% off", validity: ", valid until 30 September 2026" },
  },
  {
    key: "coupon_sponsor",
    label: "A sponsor coupon",
    when: "You send a coupon to somebody sponsoring a student. The Sponsor Guide is attached automatically.",
    group: "Offers",
    subject: "🎁 Your sponsor coupon — CA Parveen Sharma",
    body: `Thank you for choosing to sponsor a CA student with CA Parveen Sharma.

Your coupon code — **{{code}}** — gives you **{{discount}}**{{validity}}. Enter it at the checkout step when you sponsor.

The attached Sponsor Guide explains what the student receives and the simple steps to sponsor.

{{button}}`,
    vars: [
      { key: "code", note: "the coupon code" },
      { key: "discount", note: "e.g. 20% off" },
      { key: "validity", note: "e.g. , valid until 30 September" },
      BUTTON("sponsor a student"),
    ],
    sample: { code: "SPONSOR20", discount: "20% off", validity: "" },
  },
  {
    key: "scholarship_approved",
    label: "Scholarship approved",
    when: "You approve a scholarship application.",
    group: "Offers",
    subject: "💚 Your scholarship discount — CA Parveen Sharma",
    body: `Hi {{name}},

Your application has been approved. Use this coupon at checkout for **{{percent}}% off** the Gold subscription:

**{{code}}** — valid 90 days, one use.

{{button}}`,
    vars: [
      NAME,
      { key: "percent", note: "the discount percentage" },
      { key: "code", note: "the coupon code" },
      BUTTON("enrol now"),
    ],
    sample: { name: "Ravi", percent: "40", code: "SCH40AB12" },
  },
  {
    key: "trial_code",
    label: "Free-test verification code",
    when: "Somebody asks for the free case-scenario test and has to confirm their email.",
    group: "Offers",
    subject: "{{code}} is your verification code — CA Parveen Sharma",
    body: `Hi {{name}},

Your code for the free CA case-scenario test is:

{{code}}

Valid for 30 minutes. If you didn't request this, ignore this email.`,
    vars: [NAME, { key: "code", note: "the six-digit code" }],
    sample: { name: "Ravi", code: "482913" },
  },

  // ── Support ───────────────────────────────────────────────────────────────
  {
    key: "support_received",
    label: "We received their request",
    when: "Somebody raises a request on the support page.",
    group: "Support",
    subject: "We've got your request ({{ref}}) — CA Parveen Sharma",
    body: `Hi {{name}},

We've logged your request as **{{ref}}** and our team will get back to you shortly, usually with a call.

Your message: {{message}}`,
    vars: [NAME, { key: "ref", note: "the ticket reference" }, { key: "message", note: "what they wrote" }],
    sample: { name: "Ravi", ref: "TKT-1042", message: "I cannot open the Financial Reporting classes." },
  },
  {
    key: "question_answered",
    label: "Their question has been answered",
    when: "You reply to a question in Admin → Inbox and the student is not on Telegram.",
    group: "Support",
    subject: "Your question — CA Parveen Sharma",
    body: `You asked: {{question}}

{{answer}}`,
    vars: [{ key: "question", note: "what they asked" }, { key: "answer", note: "your reply" }],
    sample: { question: "Is Ind AS 116 covered in the classes?", answer: "Yes — it is Chapter 8, with two classes and a case scenario." },
  },

  // ── Classes ───────────────────────────────────────────────────────────────
  {
    key: "class_reminder",
    label: "A live class is about to start",
    when: "Automatically, shortly before a scheduled live class.",
    group: "Classes",
    subject: "⏰ {{title}} starts soon",
    body: `Your live class **{{title}}** is scheduled for **{{when}}**.

{{button}}

See you there.

CA Parveen Sharma`,
    vars: [{ key: "title", note: "the class title" }, { key: "when", note: "date and time" }, BUTTON("join the class")],
    sample: { title: "Ind AS 115 — Revenue", when: "3 Aug 2026, 6:30 pm" },
  },
];

export const EMAIL_EVENT_MAP = new Map(EMAIL_EVENTS.map((e) => [e.key, e]));

// Emails whose content is built from the student's own data (a table of marks,
// an invoice, a week of study plan). They are not text templates — listing
// them keeps the admin page honest about what it does and does not control.
export const GENERATED_EMAILS = [
  "Test report — the marks table, weak concepts and classes to redo",
  "Order invoice — the GST invoice PDF",
  "Weekly study plan — this week's rows from the student's plan",
  "Staff alerts — new ticket, escalations, warehouse dispatch, cost and feed digests",
];

// ── Rendering ───────────────────────────────────────────────────────────────

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BTN = "display:inline-block;background:#0d9488;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700";

function fill(text: string, vars: Record<string, string | number | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const k = key.toLowerCase();
    if (k === "button") return whole; // handled by the body renderer, not here
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

function inline(text: string): string {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Our own addresses become links. Trailing punctuation stays outside the
    // link — "…/support." with the full stop attached is a broken address.
    .replace(/\b(caparveensharma\.com[^\s<]*?)([.,;:!?)]*)(?=\s|$)/g, '<a href="https://$1">$1</a>$2')
    .replace(/\n/g, "<br />");
}

/**
 * Turn a written body into email HTML.
 *
 * `actionUrl` is never printed. It is only ever the href of the button that
 * replaces a `{{button}}` line — if there is no address, the line disappears
 * rather than leaving a dead button.
 */
export function bodyToHtml(body: string, actionUrl?: string, actionLabel?: string): string {
  return body
    .split(/\n\s*\n/)
    .map((para) => {
      const t = para.trim();
      if (!t) return "";
      if (/^\{\{\s*button\s*\}\}$/i.test(t)) {
        if (!actionUrl) return "";
        return `<p><a href="${actionUrl}" style="${BTN}">${esc(actionLabel || "Open")}</a></p>`;
      }
      // A paragraph that is nothing but a short code (a one-time password, a
      // coupon) is worth reading from across the room.
      if (/^[A-Z0-9-]{4,12}$/.test(t)) {
        return `<p style="font-size:26px;font-weight:800;letter-spacing:3px">${esc(t)}</p>`;
      }
      return `<p>${inline(t)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

export type TemplateVars = Record<string, string | number | undefined> & {
  /** The one-time or destination address. Rendered as a button, never as text. */
  action_url?: string;
  /** What the button says. */
  action_label?: string;
  /** Overrides the heading above the body (defaults to the subject). */
  heading?: string;
};

async function loadOverride(event: string): Promise<{ subject: string; body: string } | null> {
  try {
    const { data } = await createServiceClient()
      .from("email_templates")
      .select("subject, body")
      .eq("event", event)
      .maybeSingle();
    return data ? { subject: (data.subject as string) ?? "", body: (data.body as string) ?? "" } : null;
  } catch {
    return null; // never let a template lookup stop an email going out
  }
}

/** The wording in force for an event — the edited version if there is one. */
export async function loadTemplate(event: string): Promise<{ subject: string; body: string }> {
  const def = EMAIL_EVENT_MAP.get(event);
  const saved = await loadOverride(event);
  return {
    subject: (saved?.subject || "").trim() || def?.subject || "",
    body: (saved?.body || "").trim() || def?.body || "",
  };
}

/** Subject + full HTML, ready to send. Exported so the admin page can preview. */
export function renderTemplate(
  template: { subject: string; body: string },
  vars: TemplateVars = {},
): { subject: string; html: string } {
  const subject = fill(template.subject, vars).trim();
  const heading = String(vars.heading || subject);
  const html = emailShell(esc(heading), bodyToHtml(fill(template.body, vars), vars.action_url, vars.action_label));
  return { subject, html };
}

/**
 * Send the email for one event. This is the only way emails should be sent:
 * pass the event name and the values, and whatever wording is currently saved
 * for that event goes out.
 */
export async function sendTemplate(
  event: string,
  to: string,
  vars: TemplateVars = {},
  attachments?: EmailAttachment | EmailAttachment[],
): Promise<boolean> {
  if (!to) return false;
  const { subject, html } = renderTemplate(await loadTemplate(event), vars);
  if (!subject) return false;
  return attachments
    ? sendEmailWithAttachment(to, subject, html, attachments)
    : sendEmail(to, subject, html);
}
