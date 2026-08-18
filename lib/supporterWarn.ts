import { createServiceClient } from "@/lib/supabase/service";
import type { SiteResult } from "@/lib/supporterSite";
import { PENALTY_INR, ruleBroken } from "@/lib/supporterHold";

// WHAT THE READER FOUND, PUT TO A PERSON — AND NOT ONE WORD TO THE VENDOR
// UNTIL THAT PERSON HAS SAID SO.
//
// The founder's instruction, 18 August: "do not hold on your own, and do not
// email the vendors directly without discussing with us — you tell us these are
// the faults, we will check those faults, and then only you will send those
// mails." He is right to insist. On 15 August this machinery fined three
// vendors ₹5,000 each and emailed each of them an accusation, and all three
// findings were wrong — one of them against his own company.
//
// So the nightly read now produces DRAFTS. Nothing is held, nothing is charged,
// nothing is sent. The office opens the page, decides, and presses send or
// dismiss. Two consequences follow, and both matter:
//
//   · The warning NUMBER is decided when it is sent, never when it is drafted.
//     A draft the office dismisses was never a warning, and must not quietly
//     use up "warning 2" for a vendor who has only ever been written to once.
//   · A finding already sitting in the queue is not drafted again night after
//     night. The office should see a shop's problem once, not thirty times.

/** How long before the same unfixed page is worth raising again. */
const REPEAT_AFTER_DAYS = 7;

/** Sent warnings after which the office is told this is becoming a pattern. */
export const ESCALATE_AT = 3;

export type DraftOutcome =
  | { drafted: false; reason: "already queued" | "recently warned" | "not a warnable finding" | "no such account" }
  | { drafted: true; id: string };

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

export type PriorWarning = {
  problem: string | null;
  url: string | null;
  status: string;
  sent_at: string;
};

/**
 * Is tonight's finding worth putting in front of the office?
 *
 * Separated from all the writing and sending so the rule can be tested without
 * a database or an outbox — this is the whole decision.
 */
export function shouldDraft(
  previous: PriorWarning[],
  finding: { problem?: string; url: string },
  now: Date = new Date(),
): { draft: boolean; reason?: "already queued" | "recently warned" } {
  const same = previous.filter(
    (p) => (p.problem ?? "") === (finding.problem ?? "") && (p.url ?? "") === finding.url,
  );

  // Already waiting for the office. Raising it again is nagging them, not
  // telling them anything.
  if (same.some((p) => p.status === "pending")) return { draft: false, reason: "already queued" };

  // Already put to the vendor recently: they are given a week to act before the
  // same page counts again. A dismissed draft is not a warning and blocks
  // nothing — the office said it was not a fault.
  const lastSent = same
    .filter((p) => p.status === "sent")
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
  if (lastSent) {
    const age = now.getTime() - new Date(lastSent.sent_at).getTime();
    if (age < REPEAT_AFTER_DAYS * 86_400_000) return { draft: false, reason: "recently warned" };
  }

  return { draft: true };
}

/**
 * Write down what was found, for the office to look at. Sends nothing.
 */
export async function draftWarning(
  supporterId: string,
  url: string,
  r: SiteResult,
): Promise<DraftOutcome> {
  if (r.ok || !r.problem) return { drafted: false, reason: "not a warnable finding" };

  const svc = createServiceClient();
  const { data: who } = await svc
    .from("profiles").select("id").eq("id", supporterId).maybeSingle();
  if (!who) return { drafted: false, reason: "no such account" };

  const { data: previous } = await svc
    .from("supporter_warnings").select("problem, url, status, sent_at")
    .eq("supporter_id", supporterId).order("sent_at", { ascending: false });

  const decision = shouldDraft((previous ?? []) as PriorWarning[], { problem: r.problem, url });
  if (!decision.draft) return { drafted: false, reason: decision.reason ?? "already queued" };

  const { data: row } = await svc.from("supporter_warnings").insert({
    supporter_id: supporterId,
    number: null,               // decided when a person sends it, not before
    status: "pending",
    problem: r.problem ?? null,
    url,
    detail: r.detail ?? null,
    evidence: r.evidence ?? null,
    emailed: false,
  }).select("id").maybeSingle();

  return { drafted: true, id: String(row?.id ?? "") };
}

/** The date in the words a person would use. */
const readable = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export type SendOutcome =
  | { sent: false; reason: string }
  | { sent: true; number: number; emailed: boolean; escalated: boolean };

/**
 * Send a drafted warning, because a person has read the page and agreed.
 *
 * Called only from the admin screen, by somebody who has looked. The number is
 * worked out here — one more than the vendor has actually been sent.
 */
export async function sendDraftedWarning(warningId: string, decidedBy: string | null): Promise<SendOutcome> {
  const svc = createServiceClient();

  const { data: w } = await svc
    .from("supporter_warnings")
    .select("id, supporter_id, problem, url, detail, evidence, status")
    .eq("id", warningId).maybeSingle();
  if (!w) return { sent: false, reason: "no such warning" };
  if (String(w.status) !== "pending") return { sent: false, reason: `already ${String(w.status)}` };

  const { data: who } = await svc
    .from("profiles")
    .select("full_name, business_name, email, supporter_site_proof")
    .eq("id", String(w.supporter_id)).maybeSingle();
  if (!who) return { sent: false, reason: "no such account" };

  // The number the vendor sees counts what they have actually been sent.
  const { count } = await svc
    .from("supporter_warnings").select("id", { count: "exact", head: true })
    .eq("supporter_id", String(w.supporter_id)).eq("status", "sent");
  const number = (count ?? 0) + 1;
  const escalated = number >= ESCALATE_AT;

  const until = await graceUntil();
  const rule = ruleBroken(String(w.problem ?? ""));
  const name = String(who.business_name || who.full_name || "").trim();
  const email = String(who.email ?? "").trim();
  let emailed = false;

  if (email) {
    const { sendEmail, emailShell } = await import("@/lib/notify");
    const subject = number === 1
      ? "A note about your website — no action taken"
      : `Reminder ${number}: your website still shows this`;

    const html = emailShell(
      number === 1 ? "Something on your website" : `Reminder ${number}`,
      `<p>${name ? `Dear ${name},` : "Hello,"}</p>
       <p>We read the sites our sellers advertise from, and one of us has looked at
          <strong>${String(w.url)}</strong> today. There is something on it that does not match the seller
          agreement. <strong>Nothing has been charged and your account is working normally</strong> — you can
          place orders exactly as before. We are writing so it can be put right.</p>
       <div style="border-left:3px solid #b45309;padding:2px 0 2px 14px;margin:14px 0;line-height:1.7">
         <p style="margin:0 0 8px"><strong>What we found:</strong> ${rule}.</p>
         ${w.detail ? `<p style="margin:0 0 8px">${String(w.detail)}</p>` : ""}
         ${w.evidence ? `<p style="margin:0 0 8px"><strong>On the page:</strong> “${String(w.evidence)}”</p>` : ""}
       </div>
       ${until
         ? `<p>Until <strong>${readable(until)}</strong> these are notes only, across all our sellers, while
              everybody brings their pages into line — that takes time and we know it. After that date the agreed
              penalty of <strong>Rs. ${PENALTY_INR.toLocaleString("en-IN")}</strong> (inclusive of GST) may apply,
              so please have it corrected before then.</p>`
         : `<p>Please have this corrected. The agreed penalty for a breach is
              <strong>Rs. ${PENALTY_INR.toLocaleString("en-IN")}</strong> (inclusive of GST), and we would much
              rather write to you than use it.</p>`}
       ${escalated
         ? `<p>This is the ${number}${number === 3 ? "rd" : "th"} time we have written about your site. Please
              call the office on 98100 12674 so we can settle it together rather than by email.</p>`
         : ""}
       ${String(who.supporter_site_proof) === "code"
         ? ""
         : `<p style="color:#6b7280"><em>If this website is not yours, please tell us — it is on your account as
              your shopfront and we will correct our records.</em></p>`}
       <p><strong>If you think we have misread the page, reply to this email and say so.</strong> It is read by a
          person, and we would rather be told than have you change something that was never wrong.</p>`,
    );
    emailed = await sendEmail(email, subject, html).catch(() => false);
  }

  await svc.from("supporter_warnings").update({
    status: "sent",
    number,
    emailed,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
    escalated_at: escalated ? new Date().toISOString() : null,
  }).eq("id", warningId);

  return { sent: true, number, emailed, escalated };
}

/** The office read the page and disagreed. Nothing is sent, and it is recorded. */
export async function dismissDraftedWarning(
  warningId: string,
  decidedBy: string | null,
  reason: string,
): Promise<void> {
  await createServiceClient().from("supporter_warnings").update({
    status: "dismissed",
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
    dismissed_reason: reason.slice(0, 500) || null,
  }).eq("id", warningId).eq("status", "pending");
}
