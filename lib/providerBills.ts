import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { zohoAccountId, listZohoAccounts } from "@/lib/bankStatements";
import { rule115Rate } from "@/lib/forexRates";
import { resolveFileUrl, isSecureRef } from "@/lib/storage";

// PROVIDER INVOICES → ZOHO BILLS, WITH THE TREATMENT RULED ON ONCE.
//
// Filing a PDF in the vault is not accounting. Each invoice has to become a
// vendor bill with an expense account, a GST treatment and a TDS position — and
// those are the founder's calls, not the machine's. So the queue asks him ONCE
// per vendor, remembers the answer (provider_bill_rules), and every later
// invoice from that vendor arrives already proposed.
//
// The three GST treatments offered, which cover everything here:
//   rcm          — import of services (Vercel, Supabase, Cloudflare, Bunny,
//                  Anthropic, Mailgun): the bill carries reverse charge, so the
//                  liability and the credit both arise in his own books.
//   domestic_itc — an Indian vendor charging GST (Razorpay's fee invoice):
//                  input credit claimed as charged.
//   none         — no GST element.
// TDS is recorded per vendor too; where Zoho holds a matching TDS tax it is
// applied to the bill, and where it does not the bill is posted and the row
// says so rather than pretending.

const str = (v: unknown) => String(v ?? "").trim();

export type BillRule = {
  institution: string; vendor_name: string; expense_account: string;
  gst_treatment: string; gst_rate: number; tds_section: string | null; tds_rate: number | null;
  /** Zoho tax to apply — "GST18" for an intra-state supplier, "IGST18" for
   *  inter-state or an import. Blank falls back to IGST<rate>. */
  gst_tax_name?: string | null;
};

async function fetchText(fileUrl: string): Promise<string | null> {
  if (isSecureRef(fileUrl)) {
    const { extractPdfText } = await import("@/lib/pdf");
    return (await extractPdfText(fileUrl)) || null;
  }
  const res = await fetch(fileUrl, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return null;
  return await res.text();
}

/**
 * Queue every vault invoice that is not queued yet: read its figures, convert
 * a foreign one at its Rule-115 rate, and propose the treatment when the vendor
 * already has a rule. Returns a human summary.
 */
export async function scanVaultForBills(limit = 6): Promise<string> {
  const svc = createServiceClient();
  const { data: docs } = await svc.from("zoho_vault_docs")
    .select("id, title, institution, file_url, created_at")
    .eq("doc_type", "Invoice / bill").order("created_at");
  const { data: queued } = await svc.from("provider_bills").select("vault_doc_id");
  const have = new Set((queued ?? []).map((q) => String(q.vault_doc_id)));
  const { data: ruleRows } = await svc.from("provider_bill_rules").select("*");
  const rules = new Map((ruleRows ?? []).map((r) => [String(r.institution), r as BillRule]));

  // READ A FEW AT A TIME, AND SAY WHAT IS LEFT.
  //
  // Each invoice costs a signed URL, a download, a PDF text extract and one
  // small AI call; two dozen of those in a single request runs past the
  // serverless limit and the whole scan dies with nothing to show for it —
  // which is exactly what happened on the first press. So it takes a batch,
  // reports the remainder, and is pressed again.
  const pending = (docs ?? []).filter((d) => !have.has(String(d.id)));
  const batch = pending.slice(0, limit);

  let added = 0, asked = 0;
  for (const d of batch) {
    const institution = str(d.institution) || "Unknown";

    let facts: { invoice_no?: string; date?: string; currency?: string; tax?: number; total?: number } = {};
    // The titles this desk writes already carry the figures — "Vercel — Aug 2026
    // (USD 31.18) — UHL42VKB-0004". Reading them costs nothing, so the AI is
    // only asked about invoices that arrived without one.
    const t = str(d.title);
    const m = t.match(/\(([A-Z]{3})\s*([\d.,]+)\)/) || t.match(/\(([\d.,]+)\)/);
    if (m) {
      const hasCcy = m.length > 2;
      facts.currency = hasCcy ? m[1] : "INR";
      facts.total = Number(String(hasCcy ? m[2] : m[1]).replace(/,/g, "")) || undefined;
      const dash = t.split("—").pop()?.trim();
      if (dash && /[A-Z0-9-]{4,}/.test(dash) && !/\)/.test(dash)) facts.invoice_no = dash;
    }
    try {
      if (facts.total) throw new Error("figures already known");
      const text = await fetchText(str(d.file_url));
      if (text) {
        const { parseInvoiceText } = await import("@/lib/ai");
        facts = (await parseInvoiceText(text)) ?? {};
      }
    } catch { /* an unreadable PDF still queues — the figures can be typed in */ }

    const currency = (str(facts.currency) || "USD").toUpperCase();
    const billDate = /^\d{4}-\d{2}-\d{2}$/.test(str(facts.date)) ? str(facts.date) : String(d.created_at).slice(0, 10);
    const total = Number(facts.total) || null;

    let rate: number | null = null, rateDate: string | null = null, inr: number | null = null;
    if (currency !== "INR" && total) {
      try {
        const r = await rule115Rate(billDate, currency);
        if (r) { rate = r.rate; rateDate = r.rateDate; inr = Number((total * r.rate).toFixed(2)); }
      } catch { /* conversion retried at posting */ }
    } else if (total) inr = total;

    // A ZERO INVOICE IS A STATEMENT, NOT A BILL. Vercel and Supabase both issue
    // USD 0.00 documents for a month with nothing to pay; posting one as a
    // vendor bill would put an empty liability in the books. It is filed and
    // marked settled, not queued for a treatment.
    const isZero = total !== null && Number(total) === 0;
    const rule = rules.get(institution);
    await svc.from("provider_bills").insert({
      vault_doc_id: d.id, institution,
      bill_no: str(facts.invoice_no) || null, bill_date: billDate,
      currency, amount: total, tax_amount: Number(facts.tax) || null,
      inr_amount: inr, rate, rate_date: rateDate,
      status: isZero ? "skipped" : rule ? "draft" : "needs_info",
      proposal: rule ? { ...rule } : null,
      error: isZero ? "zero-value invoice — nothing to book" : null,
    });
    if (isZero) continue;
    if (rule) added++; else asked++;
  }
  const left = pending.length - batch.length;
  return `${added + asked} invoice(s) read — ${added} proposed from a remembered rule, ${asked} waiting for a treatment.` +
    (left > 0 ? ` ${left} still to read — press again.` : " Vault fully read.");
}

/** Save the treatment for a vendor and re-propose every waiting invoice of theirs. */
export async function saveBillRule(rule: BillRule): Promise<number> {
  const svc = createServiceClient();
  await svc.from("provider_bill_rules").upsert(
    { ...rule, updated_at: new Date().toISOString() }, { onConflict: "institution" });
  const { data: waiting } = await svc.from("provider_bills")
    .select("id").eq("institution", rule.institution).eq("status", "needs_info");
  for (const w of waiting ?? []) {
    await svc.from("provider_bills").update({
      status: "draft", proposal: { ...rule }, updated_at: new Date().toISOString(),
    }).eq("id", w.id);
  }
  return (waiting ?? []).length;
}

async function currencyIdFor(code: string): Promise<string | null> {
  try {
    const r = await zohoFetch<{ currencies?: { currency_id: string; currency_code: string }[] }>("/settings/currencies");
    return (r.currencies ?? []).find((c) => c.currency_code === code)?.currency_id ?? null;
  } catch { return null; }
}

/**
 * The vendor, in the CURRENCY THEY BILL IN.
 *
 * This is not cosmetic. A foreign vendor left on the base currency makes Zoho
 * read a USD 20 bill as ₹20 — the line rate is the supplier's own figure and
 * the exchange rate is only honoured when the bill is actually in their
 * currency. So an overseas vendor is created in that currency, and an existing
 * one still sitting on INR is corrected (safe while they have no transactions).
 */
async function findOrCreateVendor(name: string, overseas: boolean, currency: string): Promise<string> {
  const r = await zohoFetch<{ contacts?: { contact_id: string; contact_name: string; currency_code?: string }[] }>(
    "/contacts", { query: { contact_name: name, contact_type: "vendor" } });
  const hit = (r.contacts ?? []).find((c) => c.contact_name.trim().toLowerCase() === name.trim().toLowerCase());
  const wantCurrency = overseas && currency !== "INR" ? currency : null;

  if (hit) {
    if (wantCurrency && hit.currency_code && hit.currency_code !== wantCurrency) {
      const cid = await currencyIdFor(wantCurrency);
      if (cid) {
        try { await zohoFetch(`/contacts/${hit.contact_id}`, { method: "PUT", body: { currency_id: cid, gst_treatment: "overseas" } }); }
        catch { /* an established vendor cannot change currency — the bill will say so */ }
      }
    }
    return hit.contact_id;
  }

  const cid = wantCurrency ? await currencyIdFor(wantCurrency) : null;
  const made = await zohoFetch<{ contact?: { contact_id: string } }>("/contacts", {
    method: "POST",
    body: {
      contact_name: name, contact_type: "vendor",
      // An overseas supplier must be marked as such or Zoho refuses the reverse
      // charge outright ("should be applied on import of services…").
      ...(overseas ? { gst_treatment: "overseas" } : {}),
      ...(cid ? { currency_id: cid } : {}),
    },
  });
  if (!made.contact?.contact_id) throw new Error("could not create the vendor");
  return made.contact.contact_id;
}

async function taxIdByName(name: string): Promise<string | null> {
  try {
    const r = await zohoFetch<{ taxes?: { tax_id: string; tax_name: string }[] }>("/settings/taxes");
    return (r.taxes ?? []).find((t) => t.tax_name === name)?.tax_id ?? null;
  } catch { return null; }
}

/** Post one approved bill to Zoho. Idempotent: a posted row is never re-sent. */
export async function postProviderBill(id: string): Promise<void> {
  const svc = createServiceClient();
  const { data: b } = await svc.from("provider_bills").select("*").eq("id", id).maybeSingle();
  if (!b) throw new Error("bill not found");
  if (b.status === "posted") return;
  const p = (b.proposal ?? {}) as Partial<BillRule>;

  const fail = async (msg: string) => {
    await svc.from("provider_bills").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", id);
    throw new Error(msg);
  };

  try {
    if (!p.expense_account || !p.vendor_name) return fail("the treatment for this vendor is not set yet");
    const total = Number(b.amount);
    if (!total) return fail("the invoice total could not be read — type it in first");

    const currency = str(b.currency) || "USD";
    const overseas = p.gst_treatment === "rcm";
    let rate = b.rate ? Number(b.rate) : null;
    if (currency !== "INR" && !rate) {
      const r = await rule115Rate(String(b.bill_date), currency);
      if (!r) return fail("no Rule-115 rate available for this date yet");
      rate = r.rate;
    }

    const vendorId = await findOrCreateVendor(String(p.vendor_name), overseas, currency);
    const accountId = await zohoAccountId(String(p.expense_account));

    // GST: reverse charge for an import of services; the charged tax for a
    // domestic bill; nothing when the vendor charges none.
    // Named per vendor where it matters: a Delhi supplier is CGST+SGST ("GST18"),
    // a Bengaluru one billing Delhi is IGST. Import of services is IGST too.
    const taxName = p.gst_treatment === "none"
      ? null
      : (str(p.gst_tax_name) || `IGST${Number(p.gst_rate ?? 18)}`);
    const taxId = taxName ? await taxIdByName(taxName) : null;

    const body: Record<string, unknown> = {
      vendor_id: vendorId,
      bill_number: str(b.bill_no) || `${b.institution}-${String(b.id).slice(0, 8)}`,
      date: b.bill_date,
      ...(currency !== "INR" ? { exchange_rate: rate } : {}),
      // An import of services is supplied INTO his own state; without the
      // destination Zoho cannot place the reverse charge and rejects the bill.
      ...(overseas ? { is_reverse_charge_applied: true, destination_of_supply: "DL" } : {}),
      line_items: [{
        name: `${b.institution} services`,
        account_id: accountId,
        rate: total,
        quantity: 1,
        ...(taxId ? { tax_id: taxId } : {}),
      }],
      notes: `${b.institution} invoice ${str(b.bill_no)} · ${currency} ${total}` +
        (rate ? ` @ ₹${rate} (SBI TT buy ${b.rate_date}, Rule 115)` : "") +
        ` · GST: ${p.gst_treatment}` +
        (p.tds_section ? ` · TDS ${p.tds_section} @ ${p.tds_rate}%` : " · no TDS"),
    };

    // TDS, where Zoho holds a matching tax. Where it does not, the bill still
    // posts and the row says the TDS must be applied by hand — never silently.
    let tdsNote = "";
    if (p.tds_section) {
      const tds = await zohoFetch<{ taxes?: { tax_id: string; tax_name: string; tax_percentage: number }[] }>(
        "/settings/taxes", { query: { filter_by: "Taxes.Tds" } }).catch(() => null);
      const match = (tds?.taxes ?? []).find(
        (t) => t.tax_name.includes(String(p.tds_section)) || Number(t.tax_percentage) === Number(p.tds_rate));
      if (match) body.tds_tax_id = match.tax_id;
      else tdsNote = ` — TDS ${p.tds_section} @ ${p.tds_rate}% must be applied by hand (no matching TDS tax in Zoho)`;
    }

    const r = await zohoFetch<{ bill?: { bill_id: string } }>("/bills", { method: "POST", body });
    if (!r.bill?.bill_id) return fail("Zoho did not return the created bill");
    await svc.from("provider_bills").update({
      status: "posted", zoho_bill_id: r.bill.bill_id, zoho_vendor_id: vendorId,
      rate, inr_amount: rate ? Number((total * rate).toFixed(2)) : total,
      error: tdsNote || null, updated_at: new Date().toISOString(),
    }).eq("id", id);
    // The vault copy is now worked, not raw.
    if (b.vault_doc_id) await svc.from("zoho_vault_docs").update({ is_processed: true }).eq("id", b.vault_doc_id);
  } catch (e) {
    if (e instanceof Error && /treatment|total|Rule-115/.test(e.message)) throw e;
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}
