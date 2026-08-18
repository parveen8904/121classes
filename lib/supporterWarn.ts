import { createServiceClient } from "@/lib/supabase/service";
import type { SiteResult } from "@/lib/supporterSite";
import { PENALTY_INR, ruleBroken } from "@/lib/supporterHold";

// A WARNING INSTEAD OF A FINE, FOR ONE MONTH.
//
// The founder's instruction, 18 August, after three vendors were fined ₹5,000
// each for other teachers' discounts: for a month nobody is held. What the
// nightly reader finds is put to the vendor as a warning — we have seen this,
// nothing is being charged, please do not repeat it, and after the month the
// penalty applies. Everyone needs time.
//
// Three things this has to get right, or a warning becomes its own nuisance:
//
//   1. THE SAME PAGE IS NOT A NEW OFFENCE EVERY NIGHT. The reader comes round
//      daily. A vendor who was warned this morning and is arranging to have the
//      page changed must not be on their third warning by Thursday, having done
//      nothing but wait for their web person. So the same finding on the same
//      page is not warned again for a week.
//   2. A THIRD WARNING IS NOT A BLOCK. It goes to the office and a person
//      decides. That was the instruction, and it is also the only safe reading:
//      the machine that generated the three warnings is the same machine that
//      was wrong three times in August.
//   3. NOTHING IS OWED WHILE THE MONTH RUNS. The email says so in plain words,
//      because a vendor who thinks a bill is coming will ring the office in a
//      panic, and that is the opposite of what a warning is for.

/** How long before the same unfixed page counts as a fresh warning. */
const REPEAT_AFTER_DAYS = 7;

/** Warnings after which the office is asked what to do. */
const ESCALATE_AT = 3;

export type WarnOutcome =
  | { warned: false; reason: "recently warned" | "not a warnable finding" | "no such account" }
  | { warned: true; number: number; escalated: boolean; emailed: boolean };

/** Is the amnesty still running? Returns the end date while it is. */
export async function graceUntil(): Promise<Date | null> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("site_settings").select("value").eq("key", "supporter_grace_until").maybeSingle();
  const raw = String(data?.value ?? "").trim();
  if (!raw) return null;
  const until = new Date(raw.length <= 10 ? `${raw}T23:59:59+05:30` : raw);
  if (Number.isNaN(until.getTime())) return null;
  return until.getTime() > Date.now() ? until : null;
}

/**
 * Should this finding be put to the vendor as a warning, and as which number?
 *
 * Split out from the sending so it can be tested without a database or an
 * outbox: given what they have already been told and what was found today,
 * this is the whole decision.
 */
export function decideWarning(
  previous: { problem: string | null; url: string | null; sent_at: string }[],
  finding: { problem?: string; url: string },
  now: Date = new Date(),
): { send: boolean; number: number; escalate: boolean } {
  const sameFinding = previous.find(
    (p) => (p.problem ?? "") === (finding.problem ?? "") && (p.url ?? "") === finding.url,
  );
  if (sameFinding) {
    const age = now.getTime() - new Date(sameFinding.sent_at).getTime();
    if (age < REPEAT_AFTER_DAYS * 86_400_000) {
      return { send: false, number: previous.length, escalate: false };
    }
  }
  const number = previous.length + 1;
  return { send: true, number, escalate: number >= ESCALATE_AT };
}

/** The date in the words a person would use. */
const readable = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * Warn a vendor about what was found on their shopfront. Nothing is held and
 * nothing is charged: this is the whole point of the month.
 */
export async function warnForBreach(
  supporterId: string,
  url: string,
  r: SiteResult,
  until: Date,
  siteProvedByCode: boolean,
): Promise<WarnOutcome> {
  if (r.ok || !r.problem) return { warned: false, reason: "not a warnable finding" };

  const svc = createServiceClient();
  const { data: who } = await svc
    .from("profiles").select("full_name, business_name, email").eq("id", supporterId).maybeSingle();
  if (!who) return { warned: false, reason: "no such account" };

  const { data: previous } = await svc
    .from("supporter_warnings").select("problem, url, sent_at")
    .eq("supporter_id", supporterId).order("sent_at", { ascending: false });

  const decision = decideWarning(
    (previous ?? []) as { problem: string | null; url: string | null; sent_at: string }[],
    { problem: r.problem, url },
  );
  if (!decision.send) return { warned: false, reason: "recently warned" };

  const rule = ruleBroken(r.problem);
  const name = String(who.business_name || who.full_name || "").trim();
  const email = String(who.email ?? "").trim();
  let emailed = false;

  if (email) {
    const { sendEmail, emailShell } = await import("@/lib/notify");
    const subject =
      decision.number === 1
        ? "A note about your website — no action taken"
        : `Reminder ${decision.number}: your website still shows this`;

    const html = emailShell(
      decision.number === 1 ? "Something on your website" : `Reminder ${decision.number}`,
      `<p>${name ? `Dear ${name},` : "Hello,"}</p>
       <p>We read the sites our sellers advertise from. On <strong>${url}</strong> we found something that does
          not match the seller agreement. <strong>Nothing has been charged and your account is working
          normally</strong> — you can place orders exactly as before. We are telling you so that it can be put
          right.</p>
       <div style="border-left:3px solid #b45309;padding:2px 0 2px 14px;margin:14px 0;line-height:1.7">
         <p style="margin:0 0 8px"><strong>What we found:</strong> ${rule}.</p>
         ${r.detail ? `<p style="margin:0 0 8px">${r.detail}</p>` : ""}
         ${r.evidence ? `<p style="margin:0 0 8px"><strong>On the page:</strong> “${r.evidence}”</p>` : ""}
       </div>
       <p>Until <strong>${readable(until)}</strong> these are warnings only, on all our sellers, while everybody
          brings their pages into line — that takes time and we know it. After that date the agreed penalty of
          <strong>Rs. ${PENALTY_INR.toLocaleString("en-IN")}</strong> (inclusive of GST) applies, so please have
          this corrected before then.</p>
       ${decision.number >= ESCALATE_AT
         ? `<p>This is the ${decision.number}${decision.number === 3 ? "rd" : "th"} time we have written about your
              site. Please call the office on 98100 12674 so we can sort it out together rather than by email.</p>`
         : ""}
       ${siteProvedByCode
         ? ""
         : `<p style="color:#6b7280"><em>If this website is not yours, please tell us — it is on your account as
              your shopfront and we will correct our records.</em></p>`}
       <p><strong>If you think we have misread the page, reply to this email and say so.</strong> It is read by a
          person, and we would rather be told than have you put right something that was never wrong.</p>`,
    );
    emailed = await sendEmail(email, subject, html).catch(() => false);
  }

  await svc.from("supporter_warnings").insert({
    supporter_id: supporterId,
    number: decision.number,
    problem: r.problem ?? null,
    url,
    detail: r.detail ?? null,
    evidence: r.evidence ?? null,
    emailed,
    escalated_at: decision.escalate ? new Date().toISOString() : null,
  });

  return { warned: true, number: decision.number, escalated: decision.escalate, emailed };
}
