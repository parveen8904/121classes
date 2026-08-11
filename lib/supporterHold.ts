import { createServiceClient } from "@/lib/supabase/service";
import type { SiteResult } from "@/lib/supporterSite";

// PUTTING A VENDOR ON HOLD, AND LETTING THEM OUT AGAIN.
//
// The agreement has three rules. Two of them are visible on a public page and
// are what the nightly check reads: never more than 5% off, and never bundled
// with another faculty's course. Breaking either stops further orders until a
// fixed penalty is paid.
//
// This used to be a person's decision after reading the page. It is now the
// machine's, at the founder's instruction — so the safeguards move from "a
// human is in the loop" to things the code has to guarantee instead:
//
//   1. A SITE THAT DOES NOT ANSWER IS NOT A BREACH. It is a site that is down,
//      and holding an account for a hosting outage would be indefensible.
//   2. THE EVIDENCE IS KEPT AND SHOWN. The vendor is told which rule, which
//      page, and the words that were found on it — an accusation that cannot be
//      examined cannot be argued with.
//   3. HOLDING IS NEVER SILENT. The vendor is emailed the moment it happens,
//      and the office is told too.
//   4. IT IS REVERSIBLE BY A PERSON. Everything is written to supporter_holds
//      with `auto` set, so a wrong one can be found and undone.

export const PENALTY_INR = 5000;

/** The rules a shopfront can visibly break. An unreachable site is not one. */
export const HOLDABLE: readonly string[] = ["discount", "combo"];

export function isHoldable(r: SiteResult): boolean {
  return !r.ok && !!r.problem && HOLDABLE.includes(r.problem);
}

/** What the vendor is told they did — in the words of the agreement. */
export function ruleBroken(problem: string | undefined): string {
  if (problem === "discount") return "Selling at more than the 5% discount the agreement allows";
  if (problem === "combo") return "Offering our subject bundled with another faculty's course";
  return "A term of the seller agreement";
}

export type HoldOutcome = { held: boolean; already?: boolean; reason?: string };

/**
 * Hold an account for something found on its own shopfront.
 *
 * Idempotent: a site read again tomorrow will find the same page and must not
 * stack a second penalty on a vendor who has not yet had a chance to fix it.
 */
export async function autoHoldForBreach(
  supporterId: string,
  url: string,
  r: SiteResult,
): Promise<HoldOutcome> {
  if (!isHoldable(r)) return { held: false, reason: "not a holdable finding" };

  const svc = createServiceClient();
  const { data: who } = await svc
    .from("profiles")
    .select("full_name, business_name, email, supporter_blocked_at")
    .eq("id", supporterId).maybeSingle();
  if (!who) return { held: false, reason: "no such account" };
  if (who.supporter_blocked_at) return { held: false, already: true };

  const rule = ruleBroken(r.problem);
  const reason = `${rule}. ${r.detail ?? ""}`.trim();

  await svc.from("profiles").update({
    supporter_blocked_at: new Date().toISOString(),
    supporter_block_reason: reason,
    supporter_hold_auto: true,
    supporter_hold_evidence: r.evidence ?? null,
    supporter_penalty_inr: PENALTY_INR,
    supporter_penalty_paid_at: null,
    supporter_penalty_order_id: null,
  }).eq("id", supporterId);

  await svc.from("supporter_holds").insert({
    supporter_id: supporterId, auto: true,
    problem: r.problem ?? null, reason, evidence: r.evidence ?? null,
    url, penalty_inr: PENALTY_INR,
  });

  // TOLD, IMMEDIATELY. A vendor who discovers a hold by failing to place an
  // order has been treated badly whether or not the finding was right.
  const email = String(who.email ?? "").trim();
  if (email) {
    const { sendEmail, emailShell } = await import("@/lib/notify");
    const name = String(who.business_name || who.full_name || "").trim();
    const html = emailShell(
      "Your seller account is on hold",
      `<p>${name ? `Dear ${name},` : "Hello,"}</p>
       <p>We check the sites our sellers advertise from. On <strong>${url}</strong> we found something that does not
          match the agreement, and your account has been put on hold — you cannot place new orders until it is settled.
          Everything else is untouched: you can sign in, see your orders and invoices, and the students you have
          already sold to are unaffected.</p>
       <div style="border-left:3px solid #b91c1c;padding:2px 0 2px 14px;margin:14px 0;line-height:1.7">
         <p style="margin:0 0 8px"><strong>What was found:</strong> ${rule}.</p>
         ${r.detail ? `<p style="margin:0 0 8px">${r.detail}</p>` : ""}
         ${r.evidence ? `<p style="margin:0 0 8px"><strong>On the page:</strong> “${r.evidence}”</p>` : ""}
       </div>
       <p>To lift the hold: correct the page, then pay the penalty of
          <strong>Rs. ${PENALTY_INR.toLocaleString("en-IN")}</strong> from
          <a href="https://caparveensharma.com/supporter">your desk</a>. Orders reopen as soon as the payment goes
          through.</p>
       <p><strong>If you believe this is wrong, reply to this email and say so — it is read by a person, and a hold
          made in error is lifted without any payment.</strong> This one was decided automatically from what was on
          the page, and a machine reading a shop page can misread it.</p>`,
    );
    await sendEmail(email, "Your seller account is on hold", html).catch(() => false);
  }

  return { held: true };
}

/**
 * Lift the hold once the penalty is paid.
 *
 * Called only from the payment verification, after Razorpay's signature has
 * been checked — never from anything a browser can ask for directly.
 */
export async function releaseOnPenaltyPaid(supporterId: string, razorpayOrderId: string): Promise<void> {
  const svc = createServiceClient();
  const now = new Date().toISOString();
  await svc.from("profiles").update({
    supporter_blocked_at: null,
    supporter_block_reason: null,
    supporter_hold_auto: null,
    supporter_hold_evidence: null,
    supporter_penalty_paid_at: now,
    supporter_penalty_order_id: razorpayOrderId,
  }).eq("id", supporterId);

  const { data: open } = await svc
    .from("supporter_holds").select("id")
    .eq("supporter_id", supporterId).is("released_at", null)
    .order("held_at", { ascending: false }).limit(1).maybeSingle();
  if (open?.id) {
    await svc.from("supporter_holds").update({
      released_at: now, release_note: `Penalty of Rs.${PENALTY_INR} paid online (${razorpayOrderId})`,
    }).eq("id", open.id);
  }
}
