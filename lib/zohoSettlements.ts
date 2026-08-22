import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
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
async function accountId(name: string): Promise<string> {
  const r = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string }[] }>(
    "/chartofaccounts", { query: { search_text: name, filter_by: "AccountType.All" } });
  const hit = (r.chartofaccounts ?? []).find((a) => a.account_name === name);
  if (!hit) throw new Error(`Zoho account "${name}" not found`);
  return hit.account_id;
}
async function refs() {
  if (ids) return ids;
  ids = {
    axis: await accountId("Axis Current-923020019087117"),
    charges: await accountId("Payment Gateway Charges (AI)"),
    clearing: await accountId("Razorpay Clearing"),
  };
  return ids;
}

async function journalByUtr(utr: string): Promise<string | null> {
  if (!utr) return null;
  try {
    const r = await zohoFetch<{ journals?: { journal_id: string; reference_number?: string }[] }>(
      "/journals", { query: { reference_number: utr } });
    const hit = (r.journals ?? []).find((j) => (j.reference_number ?? "") === utr);
    return hit?.journal_id ?? null;
  } catch { return null; }
}

/** Pull settlements from Razorpay (cutover → now) and queue the unseen ones. */
export async function scanSettlements(): Promise<string> {
  const svc = createServiceClient();
  const from = Math.floor(CUTOVER.getTime() / 1000);
  const to = Math.floor(Date.now() / 1000);
  const items = await fetchRazorpaySettlements(from, to);

  const { data: existing } = await svc.from("zoho_settlements").select("settlement_id");
  const seen = new Set((existing ?? []).map((e) => e.settlement_id as string));

  let drafts = 0, matched = 0;
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
    const already = await journalByUtr(s.utr);
    if (already) {
      await svc.from("zoho_settlements").insert({ ...row, status: "matched", zoho_journal_id: already });
      matched++;
    } else {
      await svc.from("zoho_settlements").insert({ ...row, status: "draft" });
      drafts++;
    }
  }
  return `${drafts} settlement draft(s), ${matched} matched to existing journals.`;
}

/** Post one approved settlement as a journal. Idempotent by UTR re-check. */
export async function postSettlement(rowId: string): Promise<void> {
  const svc = createServiceClient();
  const { data: row } = await svc.from("zoho_settlements").select("*").eq("id", rowId).maybeSingle();
  if (!row) throw new Error("settlement not found");
  if (row.status === "posted" || row.status === "matched") return;

  const fail = async (msg: string) => {
    await svc.from("zoho_settlements").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", rowId);
    throw new Error(msg);
  };

  try {
    const already = await journalByUtr(String(row.utr ?? ""));
    if (already) {
      await svc.from("zoho_settlements").update({ status: "matched", zoho_journal_id: already, updated_at: new Date().toISOString() }).eq("id", rowId);
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
