import { createServiceClient } from "@/lib/supabase/service";
import { fetchRazorpaySettlements } from "@/lib/razorpay";

// RAZORPAY SETTLEMENTS — A CROSS-CHECK, NOT A POSTING ROUTE.
//
// Until 2 September 2026 this drafted a journal per settlement:
//     Dr  Axis Current (net credited)
//     Dr  Payment Gateway Charges (AI) (Razorpay's fee + the GST on it)
//     Cr  Razorpay Clearing (gross)
// The middle leg turned out to be empty on all 114 settlements — Razorpay
// bills its charges separately instead of netting them off a payout — so what
// remained was Dr the bank, Cr Razorpay Clearing, which is precisely what the
// bank statement line already posts. His instruction, and the right one:
// "remove razorpay clearing since bank statement already includes".
//
// See the note above scanSettlements for what replaced it and why. This file
// now only records what Razorpay reports, so the deposits can be checked
// against the books. It posts nothing.

const CUTOVER = new Date("2026-04-01T00:00:00+05:30");

const istDay = (unixSec: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(unixSec * 1000));

/* ═══════════════════════════════════════════════════════════════════════════
   THE SETTLEMENT NO LONGER POSTS ANYTHING. IT IS A CROSS-CHECK.
   ═══════════════════════════════════════════════════════════════════════════

   His instruction, 2 September 2026: "remove razorpay clearing since bank
   statement already includes".

   He is right, and the numbers say so plainly. All 114 settlements Razorpay
   has reported since 1 April carry ZERO fee and ZERO tax — gross equals net on
   every one, because Razorpay bills its charges separately rather than netting
   them off a payout. So the journal this queue existed to make,

       Dr  Axis Current (net)
       Dr  Payment Gateway Charges (fee + GST)
       Cr  Razorpay Clearing (gross)

   has no middle leg at all. What is left — Dr the bank, Cr Razorpay Clearing —
   is exactly the entry the bank statement line already makes when it is
   answered "Razorpay Clearing", which is what the desk has been doing.

   Two routes to one entry is not redundancy, it is a double count waiting to
   happen, and it happened: on 25 August (₹15,411) and 1 September (₹45,456)
   both the settlement AND the bank line posted, because the statement was
   uploaded before the settlement was released and neither could see the other.

   So the bank statement is now the only route. Razorpay Clearing itself stays
   — it has a real job, holding the money between the student paying and
   Razorpay depositing two days later, and it is the sale receipt's target. It
   is the SECOND leg that moved to the statement, which is where the deposit
   actually is.

   What this scan still does is record what Razorpay says, as a cross-check —
   never the sales register, never a posting. Nothing it writes is offered for
   approval.
*/
export async function scanSettlements(): Promise<string> {
  const svc = createServiceClient();
  const from = Math.floor(CUTOVER.getTime() / 1000);
  const to = Math.floor(Date.now() / 1000);
  const items = await fetchRazorpaySettlements(from, to);

  const { data: existing } = await svc.from("zoho_settlements").select("settlement_id");
  const seen = new Set((existing ?? []).map((e) => e.settlement_id as string));

  let recorded = 0, withFee = 0;
  for (const s of items) {
    if (s.status !== "processed" || seen.has(s.id)) continue;
    const net = s.amount / 100, fees = s.fees / 100, tax = s.tax / 100;
    if (fees || tax) withFee++;
    await svc.from("zoho_settlements").insert({
      settlement_id: s.id,
      utr: s.utr || null,
      settled_on: istDay(s.created_at),
      net_inr: net, fees_inr: fees, tax_inr: tax,
      gross_inr: net + fees + tax,
      status: "record",
      error: "recorded for cross-check — the bank statement books this deposit",
    });
    recorded++;
  }

  // A DRAFT LEFT OVER FROM THE OLD ROUTE MUST NOT STILL BE POSTABLE.
  const { data: left } = await svc.from("zoho_settlements").select("id").in("status", ["draft", "unverified"]);
  for (const w of left ?? []) {
    await svc.from("zoho_settlements").update({
      status: "record",
      error: "stood down — the bank statement books this deposit",
      updated_at: new Date().toISOString(),
    }).eq("id", w.id);
  }

  return `${recorded} settlement(s) recorded for cross-check. Nothing is posted from here — the bank statement books the deposit into Razorpay Clearing.`
    + (withFee ? ` ⚠️ ${withFee} of them carry a Razorpay fee, which the bank statement cannot show: the fee needs booking separately.` : "")
    + ((left ?? []).length ? ` ${(left ?? []).length} old draft(s) stood down.` : "");
}

/** Post one approved settlement as a journal. Idempotent by UTR re-check. */
export async function postSettlement(rowId: string): Promise<void> {
  // RETIRED 2 Sep 2026 — see the note above scanSettlements. The bank
  // statement books the deposit; posting from here as well is the double
  // count that prompted the change. Refusing is deliberate: an approval
  // raised before the change must not go through afterwards.
  throw new Error(`settlements are no longer posted from here — the bank statement books the deposit into Razorpay Clearing (row ${rowId})`);
}

