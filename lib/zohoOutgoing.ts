import { zohoFetch } from "@/lib/zohoApi";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoAccountType } from "@/lib/postingShape";

// WHAT WE RAISE — INVOICES, CREDIT NOTES AND JOURNAL ENTRIES.
//
// The other half of the books. Until now this desk could only book what
// arrived; anything we issued, and anything that fitted neither a bill nor an
// invoice, had to be typed in Zoho by hand.
//
// The classification is the same as on the incoming side — what it is,
// operating or not, which ledger — because the questions are the same questions.
// One thing is genuinely reversed, and it is the one most often got wrong:
//
//   TDS ON A SALE IS WITHHELD BY THE CUSTOMER.
//
// On a supplier bill we deduct and pay the government. On our own invoice the
// customer deducts from what they pay us and gives the government credit
// against OUR PAN. It is money we are owed, not money we owe — a receivable
// that has to be watched until it appears in 26AS, never an expense.

const SELLER_STATE = "DL";                     // Delhi — his registration

type Doc = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => Number(v ?? 0);

/** The ledger he named, created where it belongs if Zoho has never seen it. */
async function ledgerId(name: string, nature: string, operating: string): Promise<string> {
  const clean = s(name);
  if (!clean) throw new Error("no ledger chosen");
  const r = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string }[] }>(
    "/chartofaccounts", { query: { search_text: clean, filter_by: "AccountType.All" } });
  const found = (r.chartofaccounts ?? []).find((a) => a.account_name.trim().toLowerCase() === clean.toLowerCase());
  if (found) return found.account_id;

  const made = await zohoFetch<{ chart_of_account?: { account_id: string } }>("/chartofaccounts", {
    method: "POST",
    body: {
      account_name: /\(AI\)$/.test(clean) ? clean : `${clean} (AI)`,
      account_type: zohoAccountType(nature as never, operating as never),
    },
  });
  if (!made.chart_of_account?.account_id) throw new Error(`could not create the ledger "${clean}"`);
  return made.chart_of_account.account_id;
}

async function taxIdByName(name: string): Promise<string | null> {
  try {
    const r = await zohoFetch<{ taxes?: { tax_id: string; tax_name: string }[] }>("/settings/taxes");
    return (r.taxes ?? []).find((t) => t.tax_name === name)?.tax_id ?? null;
  } catch { return null; }
}

/** The customer, found by name or created. */
async function findOrCreateCustomer(name: string, gstin: string, state: string): Promise<string> {
  const clean = s(name);
  const r = await zohoFetch<{ contacts?: { contact_id: string; contact_name: string }[] }>(
    "/contacts", { query: { contact_name: clean, contact_type: "customer" } });
  const hit = (r.contacts ?? []).find((c) => c.contact_name.trim().toLowerCase() === clean.toLowerCase());
  if (hit) return hit.contact_id;

  const made = await zohoFetch<{ contact?: { contact_id: string } }>("/contacts", {
    method: "POST",
    body: {
      contact_name: clean, contact_type: "customer",
      ...(gstin ? { gst_treatment: "business_gst", gst_no: gstin } : { gst_treatment: "consumer" }),
      ...(state ? { place_of_contact: state } : {}),
    },
  });
  if (!made.contact?.contact_id) throw new Error("could not create the customer");
  return made.contact.contact_id;
}

/* ═══════════════════════════════════════════════════════════════════════════
   POSTING ONE DOCUMENT
   ═══════════════════════════════════════════════════════════════════════════ */
export async function postOutgoing(id: string): Promise<void> {
  const svc = createServiceClient();
  const { data: d } = await svc.from("zoho_documents").select("*").eq("id", id).maybeSingle();
  if (!d) throw new Error("document not found");
  if (d.status === "posted") return;

  const fail = async (msg: string) => {
    await svc.from("zoho_documents").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", id);
  };

  try {
    const inr = n(d.inr_amount) || n(d.amount);
    if (d.kind === "journal") return await postJournal(d as Doc, id, svc);

    const party = s(d.party_name);
    if (!party) return fail("who is it for?");
    const state = s(d.party_state) || SELLER_STATE;
    const intra = state === SELLER_STATE;
    const customerId = await findOrCreateCustomer(party, s(d.party_gstin), state);
    const accountId = await ledgerId(s(d.ledger), s(d.nature) || "income", s(d.operating) || "operating");

    // GST WE CHARGE. Intra-state is CGST+SGST, anything else IGST — the state on
    // the customer decides it, not a guess.
    const gstName = d.gst_treatment === "charged" ? (intra ? `GST${n(d.gst_rate) || 18}` : `IGST${n(d.gst_rate) || 18}`) : null;
    const taxId = gstName ? await taxIdByName(gstName) : null;

    // TDS the customer withholds — recorded on the line so Zoho shows the
    // receivable and the invoice still reads at its full value.
    let tdsTaxId: string | null = null;
    let tdsNote = "";
    if (n(d.tds_rate) > 0) {
      const t = await zohoFetch<{ taxes?: { tax_id: string; tax_name: string; tax_percentage: number }[] }>(
        "/settings/taxes", { query: { filter_by: "Taxes.Tds" } }).catch(() => null);
      const match = (t?.taxes ?? []).find((x) => Number(x.tax_percentage) === n(d.tds_rate));
      if (match) tdsTaxId = match.tax_id;
      else tdsNote = ` — the customer's ${d.tds_rate}% TDS must be recorded by hand (no matching TDS tax in Zoho)`;
    }

    const line = {
      name: (s(d.description) || s(d.ledger)).slice(0, 100),
      description: s(d.sub_account) || undefined,
      rate: n(d.amount),
      quantity: 1,
      account_id: accountId,
      ...(taxId ? { tax_id: taxId } : {}),
      ...(tdsTaxId ? { tds_tax_id: tdsTaxId } : {}),
    };

    const path = d.kind === "credit_note" ? "/creditnotes" : "/invoices";
    const key = d.kind === "credit_note" ? "creditnote" : "invoice";
    const body: Record<string, unknown> = {
      customer_id: customerId,
      date: d.doc_date,
      ...(d.kind === "credit_note" ? {} : { due_date: d.doc_date }),
      place_of_supply: state,
      gst_treatment: d.party_gstin ? "business_gst" : "consumer",
      ...(d.party_gstin ? { gst_no: s(d.party_gstin) } : {}),
      ...(s(d.reference) ? { reference_number: s(d.reference) } : {}),
      ...(s(d.doc_no) ? (d.kind === "credit_note" ? { creditnote_number: s(d.doc_no) } : { invoice_number: s(d.doc_no) }) : {}),
      ...(d.currency !== "INR" && n(d.rate) ? { exchange_rate: n(d.rate) } : {}),
      is_inclusive_tax: false,
      line_items: [line],
      notes: `${s(d.description)}${d.gst_treatment === "exempt" ? " · GST exempt" : d.gst_treatment === "zero" ? " · zero rated" : ""}`.slice(0, 500),
    };

    const r = await zohoFetch<Record<string, { [k: string]: unknown }>>(path, {
      method: "POST",
      ...(s(d.doc_no) ? { query: { ignore_auto_number_generation: "true" } } : {}),
      body,
    });
    const made = r[key] as { invoice_id?: string; creditnote_id?: string; invoice_number?: string; creditnote_number?: string } | undefined;
    const zohoId = made?.invoice_id ?? made?.creditnote_id;
    if (!zohoId) return fail("Zoho did not return the created document");

    // Draft is not an entry. An invoice must be sent, a credit note opened,
    // before either reaches a ledger.
    const openPath = d.kind === "credit_note" ? `/creditnotes/${zohoId}/status/open` : `/invoices/${zohoId}/status/sent`;
    let opened = true, why = "";
    try { await zohoFetch(openPath, { method: "POST" }); }
    catch (e) {
      const m = e instanceof Error ? e.message : "unknown";
      if (/already/i.test(m)) opened = true;
      else { opened = false; why = m; }
    }

    await svc.from("zoho_documents").update({
      status: "posted", zoho_id: zohoId,
      zoho_number: made?.invoice_number ?? made?.creditnote_number ?? null,
      inr_amount: inr || null,
      error: (opened ? "" : `raised but still a draft in Zoho — ${why}`) + tdsNote || null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
  } catch (e) {
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE JOURNAL — for everything that is neither a bill nor an invoice
   ═══════════════════════════════════════════════════════════════════════════ */
type JournalLine = { account: string; side: "debit" | "credit"; amount: number; note?: string; nature?: string; operating?: string };

export async function postJournal(d: Doc, id: string, svc: ReturnType<typeof createServiceClient>): Promise<void> {
  const lines = (d.journal_lines ?? []) as JournalLine[];
  const fail = async (msg: string) => {
    await svc.from("zoho_documents").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", id);
  };
  if (lines.length < 2) return fail("a journal needs at least two lines");

  // IT MUST BALANCE, and it is checked here rather than discovered by Zoho.
  const dr = lines.filter((l) => l.side === "debit").reduce((t, l) => t + Number(l.amount || 0), 0);
  const cr = lines.filter((l) => l.side === "credit").reduce((t, l) => t + Number(l.amount || 0), 0);
  if (Math.abs(dr - cr) > 0.01) {
    return fail(`it does not balance — debits ₹${dr.toFixed(2)} against credits ₹${cr.toFixed(2)}`);
  }

  try {
    const line_items = [];
    for (const l of lines) {
      line_items.push({
        account_id: await ledgerId(l.account, l.nature ?? "expense", l.operating ?? "operating"),
        debit_or_credit: l.side,
        amount: Number(l.amount),
        description: (l.note ?? "").slice(0, 200),
      });
    }
    const r = await zohoFetch<{ journal?: { journal_id: string; entry_number?: string } }>("/journals", {
      method: "POST",
      body: {
        journal_date: d.doc_date,
        reference_number: s(d.reference) || undefined,
        notes: s(d.description) || "Raised from the portal",
        line_items,
      },
    });
    if (!r.journal?.journal_id) return fail("Zoho did not return the created journal");
    await svc.from("zoho_documents").update({
      status: "posted", zoho_id: r.journal.journal_id, zoho_number: r.journal.entry_number ?? null,
      error: null, updated_at: new Date().toISOString(),
    }).eq("id", id);
  } catch (e) {
    await fail(e instanceof Error ? e.message : "the journal would not post");
  }
}
