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

// ---- a GSTIN, answered out of his own books ---------------------------------

export type GstFromZoho = {
  contactId: string;
  tradeName: string | null;
  legalName: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
};

/**
 * WHO IS THIS GSTIN, ACCORDING TO ZOHO BOOKS?
 *
 * His instruction, 3 September 2026: "Get it done from Zoho."
 *
 * The GSTN has no free public API, and the commercial ones want a subscription
 * — so the trade-name box sat empty and the screen said so in a way that read
 * as a fault. But a GSTIN we care about is almost always a party we already
 * trade with, and Zoho Books holds their registered name and address already,
 * keyed by exactly this number. Zoho's contact search accepts a GSTIN as its
 * search text; lib/providerBills.ts has matched vendors that way since August.
 *
 * So this asks the books instead of buying a lookup. It answers for anybody
 * already in them, which is every supplier and every supporter after their
 * first document, and costs nothing because the subscription is already paid.
 *
 * WHAT IT IS NOT: a government lookup. A GSTIN belonging to somebody we have
 * never dealt with is not in the books and cannot be, and this returns null
 * rather than inventing a name — the caller then asks a person to type it.
 * Zoho's own taxpayer lookup, which does hit the GSTN, exists only inside
 * their web and mobile forms; there is no documented API for it.
 */
export async function findPartyByGstin(gstin: string): Promise<GstFromZoho | null> {
  const want = String(gstin ?? "").trim().toUpperCase();
  if (want.length !== 15) return null;

  type Row = { contact_id: string; contact_name?: string; company_name?: string; gst_no?: string };
  const r = await zohoFetch<{ contacts?: Row[] }>(
    "/contacts", { query: { search_text: want } },
  ).catch(() => null);

  // The search is a CONTAINS match across several fields, so the GSTIN has to
  // be confirmed on the row itself — otherwise a number appearing in somebody's
  // notes would hand back the wrong party, and their address would be written
  // onto an invoice.
  const hit = (r?.contacts ?? []).find(
    (c) => String(c.gst_no ?? "").trim().toUpperCase() === want,
  );
  if (!hit) return null;

  // The list endpoint does not carry the address; the contact itself does.
  type Full = {
    contact_id: string; contact_name?: string; company_name?: string;
    billing_address?: { address?: string; street2?: string; city?: string; state?: string; zip?: string };
  };
  const one = await zohoFetch<{ contact?: Full }>(`/contacts/${hit.contact_id}`).catch(() => null);
  const c = one?.contact;
  const b = c?.billing_address ?? {};
  const s = (v: unknown): string | null => {
    const t = String(v ?? "").trim();
    return t.length ? t : null;
  };

  return {
    contactId: String(hit.contact_id),
    // Exactly as the books spell it — the same rule as lib/gstin.ts, and for
    // the same reason: a name on a tax invoice is not ours to tidy.
    tradeName: s(c?.company_name) ?? s(hit.company_name),
    legalName: s(c?.contact_name) ?? s(hit.contact_name),
    line1: s(b.address),
    line2: s(b.street2),
    city: s(b.city),
    state: s(b.state),
    pincode: s(b.zip),
  };
}
