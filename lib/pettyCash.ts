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

export type PettyBalance = { personId: string; name: string; zohoAccount: string; profileId: string | null; email: string | null; advanced: number; spent: number; balance: number };

export async function pettyBalances(): Promise<PettyBalance[]> {
  const svc = createServiceClient();
  // THE LIST MUST NOT DEPEND ON A DECORATION.
  //
  // On 1 September this asked for the login email as an EMBEDDED row —
  // `profiles(email)` — so the desk could see which account a ledger was tied
  // to. PostgREST resolves an embed through a foreign key, and petty_people had
  // none to profiles. The query failed, `data` came back null, this returned an
  // empty array, and the whole petty cash section went blank: no balances, and
  // an empty person picker that told him nobody existed while three people sat
  // in the table.
  //
  // The key is there now (migration 0058), but the shape of that failure is the
  // real lesson: an optional nicety must never be able to take the essential
  // list with it. So the people are read on their own, and the emails are a
  // second, separate query whose failure costs only the emails.
  const [{ data: people, error: peopleErr }, { data: advs }, { data: bills }] = await Promise.all([
    svc.from("petty_people").select("id, name, zoho_account_name, profile_id").eq("active", true).order("name"),
    svc.from("petty_advances").select("person_id, amount").eq("status", "posted"),
    svc.from("petty_bills").select("person_id, amount").eq("status", "approved"),
  ]);
  // Loudly, because "nobody is set up yet" and "the query broke" look identical
  // on screen and only one of them is worth acting on.
  if (peopleErr) throw new Error(`could not read the petty cash people — ${peopleErr.message}`);

  const emailBy = new Map<string, string>();
  const profileIds = (people ?? []).map((p) => p.profile_id).filter(Boolean) as string[];
  if (profileIds.length) {
    const { data: profs } = await svc.from("profiles").select("id, email").in("id", profileIds);
    for (const pr of profs ?? []) if (pr.email) emailBy.set(String(pr.id), String(pr.email));
  }
  const advBy = new Map<string, number>();
  for (const a of advs ?? []) advBy.set(a.person_id, (advBy.get(a.person_id) ?? 0) + Number(a.amount));
  const billBy = new Map<string, number>();
  for (const b of bills ?? []) billBy.set(b.person_id, (billBy.get(b.person_id) ?? 0) + Number(b.amount));
  return (people ?? []).map((p) => {
    const advanced = advBy.get(p.id) ?? 0, spent = billBy.get(p.id) ?? 0;
    return { personId: p.id, name: p.name, zohoAccount: p.zoho_account_name, profileId: p.profile_id,
      email: p.profile_id ? emailBy.get(String(p.profile_id)) ?? null : null,
      advanced, spent, balance: advanced - spent };
  });
}
