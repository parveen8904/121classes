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

/**
 * The penalty, INCLUSIVE OF GST.
 *
 * ₹5,000 is what leaves the vendor's account — the tax is inside it, not added
 * on top. That matters in two places: the vendor must never be shown ₹5,000 and
 * then charged ₹5,900, and the books must record ₹4,237.29 of income and
 * ₹762.71 of tax rather than ₹5,000 of income.
 */
export const PENALTY_INR = 5000;
export const PENALTY_GST_RATE = 18;

/** The tax hiding inside the ₹5,000, to the paisa. */
export function penaltySplit(total = PENALTY_INR, rate = PENALTY_GST_RATE): {
  total: number; taxable: number; tax: number;
} {
  const taxable = Math.round((total / (1 + rate / 100)) * 100) / 100;
  return { total, taxable, tax: Math.round((total - taxable) * 100) / 100 };
}

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

// THE FUNCTION THAT USED TO HOLD ACCOUNTS BY ITSELF IS GONE.
//
// `autoHoldForBreach` lived here. It read a shop page, stopped the account,
// booked a ₹5,000 penalty and emailed the vendor an accusation, all without a
// person seeing any of it. On 15 August it did that to three vendors over
// discounts belonging to other teachers, and one of the three was the founder's
// own company.
//
// His instruction of 18 August: do not hold on your own, and do not write to a
// vendor without asking first. Deleted rather than left unused, because an
// unused function that fines people is a loaded gun in a drawer — the nightly
// reader now drafts findings for the office (lib/supporterWarn.ts), and holding
// an account is `holdSupporter` in app/admin/supporters/actions.ts: a button, a
// typed reason, and a person's name against it.

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
    const split = penaltySplit();
    await svc.from("supporter_holds").update({
      released_at: now,
      // Written out so the books can be made up from this line alone: the tax
      // is inside the ₹5,000, not on top of it.
      release_note:
        `Penalty of Rs.${split.total} paid online (${razorpayOrderId}) — ` +
        `taxable Rs.${split.taxable.toFixed(2)} + GST Rs.${split.tax.toFixed(2)} @ ${PENALTY_GST_RATE}% (inclusive)`,
    }).eq("id", open.id);
  }
}
