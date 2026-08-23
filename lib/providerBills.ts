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
export async function scanVaultForBills(): Promise<string> {
  const svc = createServiceClient();
  const { data: docs } = await svc.from("zoho_vault_docs")
    .select("id, title, institution, file_url, created_at")
    .eq("doc_type", "Invoice / bill").order("created_at");
  const { data: queued } = await svc.from("provider_bills").select("vault_doc_id");
  const have = new Set((queued ?? []).map((q) => String(q.vault_doc_id)));
  const { data: ruleRows } = await svc.from("provider_bill_rules").select("*");
  const rules = new Map((ruleRows ?? []).map((r) => [String(r.institution), r as BillRule]));

  let added = 0, asked = 0;
  for (const d of docs ?? []) {
    if (have.has(String(d.id))) continue;
    const institution = str(d.institution) || "Unknown";

    let facts: { invoice_no?: string; date?: string; currency?: string; tax?: number; total?: number } = {};
    try {
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

    const rule = rules.get(institution);
    await svc.from("provider_bills").insert({
      vault_doc_id: d.id, institution,
      bill_no: str(facts.invoice_no) || null, bill_date: billDate,
      currency, amount: total, tax_amount: Number(facts.tax) || null,
      inr_amount: inr, rate, rate_date: rateDate,
      status: rule ? "draft" : "needs_info",
      proposal: rule ? { ...rule } : null,
    });
    if (rule) added++; else asked++;
  }
  return `${added} bill(s) proposed from remembered rules, ${asked} waiting for their first treatment.`;
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

async function findOrCreateVendor(name: string, overseas: boolean): Promise<string> {
  const r = await zohoFetch<{ contacts?: { contact_id: string; contact_name: string }[] }>(
    "/contacts", { query: { contact_name: name, contact_type: "vendor" } });
  const hit = (r.contacts ?? []).find((c) => c.contact_name.trim().toLowerCase() === name.trim().toLowerCase());
  if (hit) return hit.contact_id;
  const made = await zohoFetch<{ contact?: { contact_id: string } }>("/contacts", {
    method: "POST",
    body: {
      contact_name: name, contact_type: "vendor",
      // An overseas supplier must be marked as such or Zoho cannot apply the
      // reverse charge correctly on the bill.
      ...(overseas ? { gst_treatment: "overseas" } : {}),
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

    const vendorId = await findOrCreateVendor(String(p.vendor_name), overseas);
    const accountId = await zohoAccountId(String(p.expense_account));

    // GST: reverse charge for an import of services; the charged tax for a
    // domestic bill; nothing when the vendor charges none.
    const taxName = p.gst_treatment === "none" ? null : `IGST${Number(p.gst_rate ?? 18)}`;
    const taxId = taxName ? await taxIdByName(taxName) : null;

    const body: Record<string, unknown> = {
      vendor_id: vendorId,
      bill_number: str(b.bill_no) || `${b.institution}-${String(b.id).slice(0, 8)}`,
      date: b.bill_date,
      ...(currency !== "INR" ? { exchange_rate: rate } : {}),
      ...(overseas ? { is_reverse_charge_applied: true } : {}),
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
