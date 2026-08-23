import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { zohoAccountId } from "@/lib/bankStatements";

// PETTY CASH (IMPREST) — the founder's flow, on his existing per-person style.
//
//   accounts pays an advance → records it here → Dr <Person's advance account>
//                                                Cr <Bank>
//   the person uploads a bill (purpose + file) → accounts approves with the
//   expense account → Dr <Expense> / Cr <Person's advance account>
//   balance = posted advances − approved bills, visible to both sides.
//
// The per-person Zoho accounts already exist (Arun, Madan, Pradeep, Shripal…);
// a new person can get a fresh "<Name> — Advance (AI)" account, never touching
// anything old.

export async function ensureAdvanceAccount(name: string): Promise<string> {
  const acctName = `${name} — Advance (AI)`;
  const found = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string }[] }>(
    "/chartofaccounts", { query: { search_text: acctName, filter_by: "AccountType.All" } });
  if ((found.chartofaccounts ?? []).some((a) => a.account_name === acctName)) return acctName;
  await zohoFetch("/chartofaccounts", { method: "POST", body: { account_name: acctName, account_type: "other_current_asset" } });
  return acctName;
}

/** Post the advance journal (Dr person / Cr bank). Called right after recording. */
export async function postAdvance(advanceId: string): Promise<void> {
  const svc = createServiceClient();
  const { data: adv } = await svc.from("petty_advances")
    .select("id, adv_date, amount, bank_account_name, status, person:person_id(name, zoho_account_name)")
    .eq("id", advanceId).maybeSingle();
  if (!adv) throw new Error("advance not found");
  const person = adv.person as unknown as { name: string; zoho_account_name: string } | null;
  if (!person) throw new Error("person missing");
  try {
    const personId = await zohoAccountId(person.zoho_account_name);
    const bankId = await zohoAccountId(adv.bank_account_name);
    const j = await zohoFetch<{ journal?: { journal_id: string } }>("/journals", {
      method: "POST",
      body: {
        journal_date: adv.adv_date,
        reference_number: `ADV-${String(adv.id).slice(0, 8)}`,
        notes: `Advance to ${person.name}`,
        line_items: [
          { account_id: personId, debit_or_credit: "debit", amount: Number(adv.amount) },
          { account_id: bankId, debit_or_credit: "credit", amount: Number(adv.amount) },
        ],
      },
    });
    if (!j.journal?.journal_id) throw new Error("Zoho did not return the journal");
    await svc.from("petty_advances").update({ status: "posted", zoho_journal_id: j.journal.journal_id, error: null }).eq("id", advanceId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "posting failed";
    await svc.from("petty_advances").update({ status: "failed", error: msg }).eq("id", advanceId);
    throw new Error(msg);
  }
}

/** Post an approved bill (Dr expense / Cr person). */
export async function postBill(billId: string, expenseAccount: string): Promise<void> {
  const svc = createServiceClient();
  const { data: bill } = await svc.from("petty_bills")
    .select("id, bill_date, amount, purpose, status, file_url, person:person_id(name, zoho_account_name)")
    .eq("id", billId).maybeSingle();
  if (!bill) throw new Error("bill not found");
  const person = bill.person as unknown as { name: string; zoho_account_name: string } | null;
  if (!person) throw new Error("person missing");
  try {
    const expenseId = await zohoAccountId(expenseAccount);
    const personId = await zohoAccountId(person.zoho_account_name);
    const j = await zohoFetch<{ journal?: { journal_id: string } }>("/journals", {
      method: "POST",
      body: {
        journal_date: bill.bill_date,
        reference_number: `PCB-${String(bill.id).slice(0, 8)}`,
        notes: `${person.name} — ${String(bill.purpose).slice(0, 200)}`,
        line_items: [
          { account_id: expenseId, debit_or_credit: "debit", amount: Number(bill.amount) },
          { account_id: personId, debit_or_credit: "credit", amount: Number(bill.amount) },
        ],
      },
    });
    if (!j.journal?.journal_id) throw new Error("Zoho did not return the journal");

    // The bill they photographed, onto the entry it became. A petty-cash entry
    // with no paper is exactly the one an auditor asks about.
    let paper: string | null = null;
    if (bill.file_url) {
      const { attachToZoho } = await import("@/lib/zohoAttach");
      const att = await attachToZoho("journal", j.journal.journal_id, String(bill.file_url),
        `${person.name} ${String(bill.bill_date)}.pdf`.replace(/[^\w.\- ]+/g, "_"));
      if (!att.ok) paper = `posted, but the bill image is not attached (${att.note})`;
    }

    await svc.from("petty_bills").update({
      status: "approved", expense_account: expenseAccount, zoho_journal_id: j.journal.journal_id,
      paper_note: paper, error: null, updated_at: new Date().toISOString(),
    }).eq("id", billId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "posting failed";
    await svc.from("petty_bills").update({ status: "failed", error: msg, expense_account: expenseAccount, updated_at: new Date().toISOString() }).eq("id", billId);
    throw new Error(msg);
  }
}

export type PettyBalance = { personId: string; name: string; zohoAccount: string; profileId: string | null; advanced: number; spent: number; balance: number };

export async function pettyBalances(): Promise<PettyBalance[]> {
  const svc = createServiceClient();
  const [{ data: people }, { data: advs }, { data: bills }] = await Promise.all([
    svc.from("petty_people").select("id, name, zoho_account_name, profile_id").eq("active", true).order("name"),
    svc.from("petty_advances").select("person_id, amount").eq("status", "posted"),
    svc.from("petty_bills").select("person_id, amount").eq("status", "approved"),
  ]);
  const advBy = new Map<string, number>();
  for (const a of advs ?? []) advBy.set(a.person_id, (advBy.get(a.person_id) ?? 0) + Number(a.amount));
  const billBy = new Map<string, number>();
  for (const b of bills ?? []) billBy.set(b.person_id, (billBy.get(b.person_id) ?? 0) + Number(b.amount));
  return (people ?? []).map((p) => {
    const advanced = advBy.get(p.id) ?? 0, spent = billBy.get(p.id) ?? 0;
    return { personId: p.id, name: p.name, zohoAccount: p.zoho_account_name, profileId: p.profile_id, advanced, spent, balance: advanced - spent };
  });
}
