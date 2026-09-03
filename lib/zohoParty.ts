import { zohoFetch } from "@/lib/zohoApi";

// A SUPPLIER OR A CUSTOMER, BY NAME.
//
// His ask, 3 September 2026: "if it is Vendor payment, we should be able to
// process it as Vendor payment or customer payment".
//
// A bank line that settles a document already knows the party — it comes off
// the bill or the invoice (lib/bankSettle.ts). A line that settles nothing
// does not, so the desk names it, and this turns that name into a Zoho
// contact.
//
// Deliberately small. There is a much richer vendor resolver in
// lib/providerBills.ts that carries GSTIN, MSME status, addresses and the
// TDS consequences of all three — but that belongs to a supplier's INVOICE,
// where those facts arrive on paper and matter. A bank payment names a party
// and nothing more, and inventing the rest from a bank narration would be
// making it up.

type ZContact = { contact_id: string; contact_name: string; contact_type?: string };

/**
 * Find the contact by name, or create one.
 *
 * Matching is exact on the trimmed, case-folded name: Zoho's `contact_name`
 * query is a prefix search, so "Pawan" would otherwise attach a payment to
 * "Pawan Kumar Enterprises" — the wrong ledger, silently.
 */
export async function findOrCreateParty(
  name: string,
  type: "vendor" | "customer",
): Promise<{ id: string; created: boolean }> {
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error(`name the ${type === "vendor" ? "supplier" : "customer"} first`);

  const r = await zohoFetch<{ contacts?: ZContact[] }>(
    "/contacts", { query: { contact_name: clean, contact_type: type } },
  ).catch(() => null);

  const hit = (r?.contacts ?? []).find(
    (c) => String(c.contact_name ?? "").trim().toLowerCase() === clean.toLowerCase(),
  );
  if (hit) return { id: hit.contact_id, created: false };

  // NOT FOUND UNDER THAT TYPE IS NOT THE SAME AS NOT THERE.
  //
  // Zoho contacts can be a customer, a vendor, or both. Somebody who has only
  // ever been billed TO exists as a customer; the first time we pay them, a
  // blind create would make a second contact with the same name and split
  // their history across two ledgers. So look again without the type filter
  // and, if they are there, widen the existing one instead.
  const any = await zohoFetch<{ contacts?: ZContact[] }>(
    "/contacts", { query: { contact_name: clean } },
  ).catch(() => null);
  const other = (any?.contacts ?? []).find(
    (c) => String(c.contact_name ?? "").trim().toLowerCase() === clean.toLowerCase(),
  );
  if (other) {
    try {
      await zohoFetch(`/contacts/${other.contact_id}`, {
        method: "PUT",
        body: { contact_type: "customer_and_vendor" },
      });
    } catch { /* if Zoho will not widen it, the payment can still be attempted */ }
    return { id: other.contact_id, created: false };
  }

  const made = await zohoFetch<{ contact?: { contact_id: string } }>("/contacts", {
    method: "POST",
    body: { contact_name: clean, contact_type: type },
  });
  if (!made.contact?.contact_id) throw new Error(`Zoho would not create the contact "${clean}"`);
  return { id: made.contact.contact_id, created: true };
}

/**
 * A payment that settles no particular document — an advance, or a refund.
 *
 * Zoho accepts a vendor payment with no `bills` and a customer payment with no
 * `invoices`; it sits on the party's account as unapplied and can be knocked
 * off a document later. That is the honest record for money that has moved
 * without a bill to point at, and it is what a bank line usually is.
 */
export async function unappliedPayment(p: {
  kind: "vendor" | "customer";
  partyId: string;
  amount: number;
  date: string;
  bankAccountId: string;
  reference: string;
  narration: string;
}): Promise<string> {
  const amount = Number(p.amount.toFixed(2));
  if (!(amount > 0)) throw new Error("a payment needs an amount");

  if (p.kind === "vendor") {
    const r = await zohoFetch<{ vendorpayment?: { payment_id: string } }>("/vendorpayments", {
      method: "POST",
      body: {
        vendor_id: p.partyId,
        payment_mode: "banktransfer",
        date: p.date,
        amount,
        paid_through_account_id: p.bankAccountId,
        ...(p.reference ? { reference_number: p.reference } : {}),
        description: p.narration,
      },
    });
    if (!r.vendorpayment?.payment_id) throw new Error("Zoho did not return the payment");
    return r.vendorpayment.payment_id;
  }

  const r = await zohoFetch<{ payment?: { payment_id: string } }>("/customerpayments", {
    method: "POST",
    body: {
      customer_id: p.partyId,
      payment_mode: "banktransfer",
      date: p.date,
      amount,
      account_id: p.bankAccountId,
      ...(p.reference ? { reference_number: p.reference } : {}),
      description: p.narration,
    },
  });
  if (!r.payment?.payment_id) throw new Error("Zoho did not return the receipt");
  return r.payment.payment_id;
}

// ---- the parties themselves, for a picker ----------------------------------

let partyList: { rows: PartyRow[]; at: number } | null = null;

export type PartyRow = { id: string; name: string; type: string };

/**
 * Every supplier and customer in Zoho.
 *
 * The vault asked "Which account / party?" with a datalist of BANK ACCOUNTS
 * behind it — so filing a supplier invoice offered nothing to pick, and the
 * only way through was to type the name and hope it matched something later.
 * A chart of accounts has no suppliers in it; they are contacts.
 *
 * Cached for ten minutes like listZohoAccounts, because this is drawn on a
 * page and a person can classify a dozen documents in that time.
 */
export async function listZohoParties(): Promise<PartyRow[]> {
  if (partyList && Date.now() - partyList.at < 10 * 60_000) return partyList.rows;
  const rows: PartyRow[] = [];
  const seen = new Set<string>();
  // Pages are read until one comes back empty — has_more_page is not trusted,
  // for the same reason listZohoAccounts does not trust it.
  for (let page = 1; page <= 8; page++) {
    const r = await zohoFetch<{ contacts?: { contact_id: string; contact_name: string; contact_type?: string }[] }>(
      "/contacts", { query: { per_page: "200", page: String(page) } },
    ).catch(() => null);
    const batch = r?.contacts ?? [];
    if (!batch.length) break;
    for (const c of batch) {
      const name = String(c.contact_name ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      rows.push({ id: c.contact_id, name, type: String(c.contact_type ?? "") });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  partyList = { rows, at: Date.now() };
  return rows;
}
