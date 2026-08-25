import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { accountId as lookupAccountId } from "@/lib/zohoLookup";
import { fetchRazorpaySettlements } from "@/lib/razorpay";

// RAZORPAY SETTLEMENTS → ZOHO, squared to the paisa.
//
// One settlement = one bank credit. The journal per settlement:
//     Dr  Axis Current (net credited)
//     Dr  Payment Gateway Charges (AI) (Razorpay's fee + the GST on it)
//     Cr  Razorpay Clearing (gross)
// so the clearing account's balance always equals exactly the money still in
// transit. Reference number = the bank UTR — the same handle the bank
// statement and the team use, which is also how duplicates are recognised.
//
// GST note (founder to rule later): the GST on gateway fees is booked INTO the
// expense for now (no input-credit assumption). If he decides to claim ITC,
// the tax leg moves to Input IGST — one-line change, flagged in memory.
//
// MATCH-DON'T-DUPLICATE: before drafting, existing Zoho journals are searched
// by the UTR; a hit links the settlement as 'matched'. The same check runs
// again at posting time. The team keeps full freedom to book manually.

const CUTOVER = new Date("2026-04-01T00:00:00+05:30");

const istDay = (unixSec: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(unixSec * 1000));

let ids: { axis: string; charges: string; clearing: string } | null = null;
// Shared and cached in the database — the private copy here asked Zoho three
// times per settlement and its cache died with each serverless invocation.
// See lib/zohoLookup.ts.
const accountId = (name: string) => lookupAccountId(name);
async function refs() {
  if (ids) return ids;
  ids = {
    axis: await accountId("Axis Current-923020019087117"),
    charges: await accountId("Payment Gateway Charges (AI)"),
    clearing: await accountId("Razorpay Clearing"),
  };
  return ids;
}

/**
 * IS THIS SETTLEMENT ALREADY IN THE BOOKS?
 *
 * THREE ANSWERS, NOT TWO. This used to return a journal id or null, and it
 * turned any failure into null with `catch { return null }` — so a Zoho hiccup,
 * an expired token or a permission problem all read as "no, book it again".
 * A duplicate-check that fails open is not a duplicate-check. It now returns
 * "unknown" when it could not find out, and the caller must NOT queue a row it
 * could not verify.
 *
 * WHY LOOKING AT JOURNALS ALONE WAS NOT ENOUGH. On 24 Aug 2026 all 107
 * settlements from 1 April onwards were sitting as unposted drafts — ₹79,05,952
 * of them — while Zoho itself said otherwise: Razorpay Clearing held ₹2,27,015,
 * not the ₹79 lakh it would hold if none of this had been cleared, and the
 * desk's own "Payment Gateway Charges (AI)" account had never been touched.
 * The office books these through Zoho's BANKING module, and a bank transaction
 * is not a journal, so /journals could never see them. Releasing that queue
 * would have written 107 duplicate journals into a live ledger.
 *
 * So both places are searched: journals by reference number, and bank
 * transactions on the clearing account by amount and date.
 */
type Existing = { kind: "journal" | "banktransaction"; id: string } | null | "unknown";

async function alreadyBooked(utr: string, amountInr: number, onDate: string): Promise<Existing> {
  let looked = false;

  // 1. A journal carrying the UTR as its reference — what this desk writes.
  if (utr) {
    try {
      const r = await zohoFetch<{ journals?: { journal_id: string; reference_number?: string }[] }>(
        "/journals", { query: { reference_number: utr } });
      looked = true;
      const hit = (r.journals ?? []).find((j) => (j.reference_number ?? "") === utr);
      if (hit) return { kind: "journal", id: hit.journal_id };
    } catch { /* fall through — `looked` stays false so we cannot claim "not there" */ }
  }

  // 2. A bank transaction on Razorpay Clearing for the same money on the same
  //    day — what the office actually does. Matched on amount to the paisa and
  //    on the settlement date, because their reference is their own wording.
  try {
    const clearing = (await refs()).clearing;
    const r = await zohoFetch<{ banktransactions?: { transaction_id: string; amount?: number; date?: string }[] }>(
      "/banktransactions", { query: { account_id: clearing, date: onDate } });
    looked = true;
    const hit = (r.banktransactions ?? []).find(
      (t) => Math.abs(Number(t.amount ?? 0) - amountInr) < 0.02 && (t.date ?? "") === onDate,
    );
    if (hit) return { kind: "banktransaction", id: hit.transaction_id };
  } catch { /* same — a failure here must not read as "not there" */ }

  return looked ? null : "unknown";
}

/** Pull settlements from Razorpay (cutover → now) and queue the unseen ones. */
export async function scanSettlements(): Promise<string> {
  const svc = createServiceClient();
  const from = Math.floor(CUTOVER.getTime() / 1000);
  const to = Math.floor(Date.now() / 1000);
  const items = await fetchRazorpaySettlements(from, to);

  const { data: existing } = await svc.from("zoho_settlements").select("settlement_id");
  const seen = new Set((existing ?? []).map((e) => e.settlement_id as string));

  let drafts = 0, matched = 0, unverified = 0;
  for (const s of items) {
    if (s.status !== "processed" || seen.has(s.id)) continue;
    const net = s.amount / 100, fees = s.fees / 100, tax = s.tax / 100;
    const row = {
      settlement_id: s.id,
      utr: s.utr || null,
      settled_on: istDay(s.created_at),
      net_inr: net, fees_inr: fees, tax_inr: tax,
      gross_inr: net + fees + tax,
    };
    const already = await alreadyBooked(s.utr, row.gross_inr, row.settled_on);
    if (already === "unknown") {
      // COULD NOT CHECK IS NOT THE SAME AS NOT THERE. A row we failed to verify
      // is parked, never queued: the desk can look at it, but nothing offers to
      // post it, because posting it might duplicate what is already booked.
      await svc.from("zoho_settlements").insert({ ...row, status: "unverified" });
      unverified++;
    } else if (already) {
      await svc.from("zoho_settlements").insert({
        ...row, status: "matched",
        zoho_journal_id: already.kind === "journal" ? already.id : null,
        error: already.kind === "banktransaction" ? `already in the books as a bank transaction (${already.id})` : null,
      });
      matched++;
    } else {
      await svc.from("zoho_settlements").insert({ ...row, status: "draft" });
      drafts++;
    }
  }
  // RE-ASK ABOUT WHAT IS ALREADY QUEUED.
  //
  // The loop above only ever looks at settlements it has not seen before, so a
  // draft raised under the old journals-only check stayed a draft for ever,
  // however plainly it was already in the books. That is how 107 of them came
  // to be offered at once. Every waiting draft is therefore re-checked here
  // against both places, and the ones that are already booked step aside.
  const { data: waiting } = await svc.from("zoho_settlements")
    .select("id, utr, gross_inr, settled_on").eq("status", "draft");
  let recognised = 0, parked = 0;
  for (const w of waiting ?? []) {
    const found = await alreadyBooked(String(w.utr ?? ""), Number(w.gross_inr), String(w.settled_on));
    if (found === "unknown") {
      await svc.from("zoho_settlements").update({ status: "unverified", updated_at: new Date().toISOString() }).eq("id", w.id);
      parked++;
    } else if (found) {
      await svc.from("zoho_settlements").update({
        status: "matched",
        zoho_journal_id: found.kind === "journal" ? found.id : null,
        error: found.kind === "banktransaction" ? `already in the books as a bank transaction (${found.id})` : null,
        updated_at: new Date().toISOString(),
      }).eq("id", w.id);
      recognised++;
    }
  }

  return `${drafts} settlement draft(s), ${matched} already in the books and left alone` +
    (recognised ? `. Re-checked what was already queued: ${recognised} of those are in Zoho already and have been stood down` : "") +
    (unverified + parked ? `. ${unverified + parked} could NOT be checked against Zoho and are parked as unverified — none of those will be offered for posting` : "") + ".";
}

/** Post one approved settlement as a journal. Idempotent by UTR re-check. */
export async function postSettlement(rowId: string): Promise<void> {
  const svc = createServiceClient();
  const { data: row } = await svc.from("zoho_settlements").select("*").eq("id", rowId).maybeSingle();
  if (!row) throw new Error("settlement not found");
  if (row.status === "posted" || row.status === "matched") return;
  if (row.status === "unverified") throw new Error("this settlement was never verified against Zoho — re-scan before posting it");

  const fail = async (msg: string) => {
    await svc.from("zoho_settlements").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", rowId);
    throw new Error(msg);
  };

  try {
    // The same question is asked again at the gate, because the office may have
    // booked it in the hours between the scan and his approval.
    const already = await alreadyBooked(String(row.utr ?? ""), Number(row.gross_inr), String(row.settled_on));
    if (already === "unknown") {
      return fail("could not check Zoho for an existing entry — refusing to post in case this is already in the books");
    }
    if (already) {
      await svc.from("zoho_settlements").update({
        status: "matched",
        zoho_journal_id: already.kind === "journal" ? already.id : null,
        error: already.kind === "banktransaction" ? `already in the books as a bank transaction (${already.id})` : null,
        updated_at: new Date().toISOString(),
      }).eq("id", rowId);
      return;
    }
    const R = await refs();
    const net = Number(row.net_inr), feeTotal = Number(row.fees_inr) + Number(row.tax_inr), gross = Number(row.gross_inr);
    const lines = [
      { account_id: R.axis, debit_or_credit: "debit", amount: net },
      ...(feeTotal > 0 ? [{ account_id: R.charges, debit_or_credit: "debit", amount: feeTotal }] : []),
      { account_id: R.clearing, debit_or_credit: "credit", amount: gross },
    ];
    const j = await zohoFetch<{ journal?: { journal_id: string } }>("/journals", {
      method: "POST",
      body: {
        journal_date: row.settled_on,
        reference_number: String(row.utr ?? row.settlement_id),
        notes: `Razorpay settlement ${row.settlement_id} — gross ₹${gross.toFixed(2)}, fee+GST ₹${feeTotal.toFixed(2)}, net ₹${net.toFixed(2)}`,
        line_items: lines,
      },
    });
    if (!j.journal?.journal_id) return fail("Zoho did not return the created journal");
    await svc.from("zoho_settlements").update({
      status: "posted", zoho_journal_id: j.journal.journal_id, error: null,
      posted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", rowId);
  } catch (e) {
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}
