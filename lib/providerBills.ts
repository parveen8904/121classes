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
  /** The foreign-vendor answers — facts the accounts desk gives once per
   *  vendor, from which the withholding and the Form 145 part are worked out.
   *  Absent on a domestic vendor. */
  country?: string | null; service_category?: string | null; billing_frequency?: string | null;
  has_trc?: boolean; has_form10f?: boolean; has_no_pe?: boolean; has_395_cert?: boolean;
  expected_annual?: number | null;
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

/** 1 April to 31 March — the year the Form 145 aggregate is measured over. */
export function fyStart(onISO: string): string {
  const y = Number(onISO.slice(0, 4)), m = Number(onISO.slice(5, 7));
  return `${m < 4 ? y - 1 : y}-04-01`;
}

/**
 * Everything already booked to this vendor this financial year, NOT counting
 * the invoice being looked at — it is already a row here, and the reasoning
 * adds it on top. Counting it twice would push a vendor over the ₹5,00,000
 * line early and call for an accountant's certificate that is not yet due.
 */
async function paidThisFy(institution: string, onISO: string, exceptId?: string): Promise<number> {
  const svc = createServiceClient();
  let q = svc.from("provider_bills")
    .select("id, inr_amount")
    .eq("institution", institution)
    .neq("status", "skipped")
    .gte("bill_date", fyStart(onISO))
    .lte("bill_date", onISO);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q;
  return (data ?? []).reduce((t, r) => t + Number(r.inr_amount ?? 0), 0);
}

/** Has the desk been given the foreign answers for this vendor yet? */
export function foreignAnswered(rule?: Partial<BillRule> | null): boolean {
  return Boolean(rule && rule.country && rule.service_category && rule.billing_frequency);
}

/**
 * The desk's working for one invoice — what to withhold, which part of Form 145,
 * whether an accountant's certificate has to come first.
 */
export async function determineFor(b: {
  id?: string; institution: string; bill_date: string; inr_amount: number | null; currency: string;
}, rule: Partial<BillRule>) {
  const { determineForeign } = await import("@/lib/foreignVendorDesk");
  const svc = createServiceClient();
  const { data: gstRow } = await svc.from("site_settings").select("value").eq("key", "gst_registered").maybeSingle();
  const paid = await paidThisFy(b.institution, b.bill_date, b.id);
  return determineForeign({
    country: String(rule.country),
    service_category: (rule.service_category ?? "standardised") as never,
    billing_frequency: (rule.billing_frequency ?? "monthly") as never,
    has_trc: !!rule.has_trc, has_form10f: !!rule.has_form10f,
    has_no_pe: !!rule.has_no_pe, has_395_cert: !!rule.has_395_cert,
    expected_annual: rule.expected_annual ?? null,
  }, {
    inrAmount: Number(b.inr_amount ?? 0),
    paidThisFy: paid,
    // He is registered; the setting is here so it is one edit if that changes.
    gstRegistered: gstRow ? String(gstRow.value) !== "false" : true,
  });
}

/**
 * Work out, and record, what is to happen to every waiting invoice from this
 * vendor. Called the moment the desk answers the questions, so the queue moves
 * on its own rather than needing another scan.
 */
export async function redetermineWaiting(institution: string): Promise<number> {
  const svc = createServiceClient();
  const { data: rule } = await svc.from("provider_bill_rules")
    .select("*").eq("institution", institution).maybeSingle();
  if (!foreignAnswered(rule as Partial<BillRule>)) return 0;

  const { data: rows } = await svc.from("provider_bills")
    .select("id, institution, bill_date, inr_amount, currency, amount")
    .eq("institution", institution).in("status", ["needs_info", "draft"]);

  let moved = 0;
  for (const b of rows ?? []) {
    if (!b.bill_date || !b.inr_amount) continue;   // a row missing its figures still waits for a person
    const d = await determineFor(b as never, rule as Partial<BillRule>);
    await svc.from("provider_bills").update({
      status: d.tdsRate === null ? "needs_info" : "draft",
      proposal: { ...(rule as Record<string, unknown>) },
      determination: d as unknown as Record<string, unknown>,
      tds_rate_applied: d.tdsRate,
      form145_part: d.form145Part,
      form146_required: d.form146Required,
      error: d.tdsRate === null ? "the withholding on this one needs your CA — the desk proposes no rate for advertising" : null,
      updated_at: new Date().toISOString(),
    }).eq("id", b.id);
    moved++;
  }
  return moved;
}

/**
 * Queue every vault invoice that is not queued yet: read its figures, convert
 * a foreign one at its Rule-115 rate, and propose the treatment when the vendor
 * already has a rule. Returns a human summary.
 */
export async function scanVaultForBills(limit = 3): Promise<string> {
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
  // reports the remainder, and is pressed again. The batch is SMALL because
  // every invoice is now genuinely read rather than guessed from its title.
  const pending = (docs ?? []).filter((d) => !have.has(String(d.id)));
  const batch = pending.slice(0, limit);

  let added = 0, asked = 0;
  for (const d of batch) {
    const institution = str(d.institution) || "Unknown";

    let facts: { invoice_no?: string; date?: string; currency?: string; tax?: number; total?: number } = {};
    // The titles this desk writes carry the figures — "Vercel — Aug 2026
    // (USD 31.18) — UHL42VKB-0004" — so they are read first, for free.
    //
    // But a title is a label, not the invoice. It never carries the invoice's
    // OWN DATE, and some of them (Bunny's, filed by API) carry a bare number
    // with no currency. Trusting that shortcut booked twelve Bunny invoices as
    // rupees on today's date — wrong currency, wrong period, and therefore the
    // wrong Rule-115 rate. So the title is now only a cross-check: the paper is
    // read whenever the date or the currency is still unknown.
    const t = str(d.title);
    const m = t.match(/\(([A-Z]{3})\s*([\d.,]+)\)/);
    const bare = m ? null : t.match(/\(([\d.,]+)\)/);
    if (m || bare) {
      if (m) facts.currency = m[1];
      facts.total = Number(String(m ? m[2] : bare![1]).replace(/,/g, "")) || undefined;
      const dash = t.split("—").pop()?.trim();
      if (dash && /[A-Z0-9-]{4,}/.test(dash) && !/\)/.test(dash)) facts.invoice_no = dash;
    }
    const fromTitle = facts.total ?? null;
    try {
      if (facts.total && facts.currency && facts.date) throw new Error("figures already known");
      const text = await fetchText(str(d.file_url));
      if (text) {
        const { parseInvoiceText } = await import("@/lib/ai");
        const read = await parseInvoiceText(text);
        if (read) facts = { ...facts, ...read };
      }
    } catch { /* an unreadable PDF still queues — the figures can be typed in */ }

    const currency = (str(facts.currency) || "USD").toUpperCase();
    // Where the invoice's own date could not be read, the filing date stands in
    // — and the row SAYS SO, because the date decides both the GST period and
    // the conversion rate.
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(str(facts.date));
    const billDate = dated ? str(facts.date) : String(d.created_at).slice(0, 10);
    const total = Number(facts.total) || null;
    // The title and the paper disagreeing is worth a human eye, not a guess.
    const mismatch = fromTitle !== null && total !== null && Math.abs(fromTitle - total) > 0.01
      ? `the title says ${fromTitle} but the invoice reads ${total}` : null;

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
    // A FOREIGN invoice needs more than an expense account. Until the desk has
    // answered where the vendor is, what they actually did and what papers are
    // on file, there is no way to know what to withhold — so it waits, even
    // when a treatment rule already exists.
    const isForeign = currency !== "INR";
    const needsForeignAnswers = isForeign && !foreignAnswered(rule);
    await svc.from("provider_bills").insert({
      vault_doc_id: d.id, institution,
      bill_no: str(facts.invoice_no) || null, bill_date: billDate,
      currency, amount: total, tax_amount: Number(facts.tax) || null,
      inr_amount: inr, rate, rate_date: rateDate,
      // A row whose date or figures are uncertain is never left as a one-tick
      // posting — it waits for a person.
      status: isZero ? "skipped"
        : (!dated || mismatch || !total || needsForeignAnswers) ? "needs_info"
        : rule ? "draft" : "needs_info",
      proposal: rule ? { ...rule } : null,
      error: isZero ? "zero-value invoice — nothing to book"
        : mismatch ? `check the amount — ${mismatch}`
        : !total ? "the amount could not be read — type it in before posting"
        : !dated ? `the invoice's own date could not be read — ${billDate} is the filing date, set the real one before posting`
        : needsForeignAnswers ? "foreign vendor — the desk needs the withholding questions answered before this can be booked"
        : null,
    });
    if (isZero) continue;
    if (rule && dated && total && !mismatch && !needsForeignAnswers) added++; else asked++;
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

// His own state — the destination of every service he imports.
const HOME_STATE = "DL";

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

type ZohoBill = {
  bill_id: string; vendor_name?: string; currency_code?: string; exchange_rate?: number;
  sub_total?: number; tax_total?: number; total?: number; is_reverse_charge_applied?: boolean;
  gst_treatment?: string; status?: string;
};

/**
 * What Zoho itself holds for the bill — not what we sent it.
 *
 * A posting is only really verified when the books say so, so the created bill
 * is echoed back onto the row: the currency and rate it actually used, the
 * totals it computed, and whether the reverse charge landed at all.
 */
function echoOf(b: ZohoBill) {
  return {
    vendor: b.vendor_name ?? null, currency: b.currency_code ?? null, exchange_rate: b.exchange_rate ?? null,
    sub_total: b.sub_total ?? null, tax_total: b.tax_total ?? null, total: b.total ?? null,
    reverse_charge: b.is_reverse_charge_applied ?? null, gst_treatment: b.gst_treatment ?? null,
    zoho_status: b.status ?? null, read_at: new Date().toISOString(),
  };
}

/**
 * Walk a created bill as far towards the ledgers as this org allows.
 *
 * A bill that stays a draft is a piece of paper: no expense, no GST return. So
 * it is submitted and then opened. But his Zoho has BILL APPROVAL switched on,
 * and that is his control, not ours — the desk never approves in his place. If
 * approval is what stands in the way, the row says so in plain words.
 *
 * A swallowed failure here would be the worst kind: the queue reading "posted"
 * over a bill sitting outside the books. So every reason travels back.
 */
async function advanceBill(billId: string): Promise<{ state: "open" | "awaiting_approval" | "draft"; why?: string }> {
  const submit = await zohoFetch(`/bills/${billId}/submit`, { method: "POST" })
    .then(() => null).catch((e: unknown) => (e instanceof Error ? e.message : "unknown"));
  try {
    await zohoFetch(`/bills/${billId}/status/open`, { method: "POST" });
    return { state: "open" };
  } catch (e) {
    const why = e instanceof Error ? e.message : "unknown";
    // Zoho's own words settle it. An edited bill can still read "draft" on the
    // record while the books already hold it as open, and reporting THAT as
    // "not in the ledgers" would be a false alarm — as bad as hiding a real one.
    if (/already in open status/i.test(why)) return { state: "open" };
    if (/not been approved/i.test(why)) {
      return { state: "awaiting_approval", why: "waiting for approval in Zoho — your books have bill approval switched on" };
    }
    return { state: "draft", why: submit ? `${why} (submit also failed: ${submit})` : why };
  }
}

/**
 * Re-read posted bills from Zoho and record what it holds — and finish any that
 * are still sitting as drafts there, since a draft reaches no ledger.
 */
export async function readbackPostedBills(): Promise<{ checked: number; opened: number }> {
  const svc = createServiceClient();
  const { data } = await svc.from("provider_bills")
    .select("id, zoho_bill_id").eq("status", "posted").not("zoho_bill_id", "is", null).limit(50);
  let checked = 0, opened = 0;
  for (const row of data ?? []) {
    try {
      let r = await zohoFetch<{ bill?: ZohoBill }>(`/bills/${row.zoho_bill_id}`);
      if (!r.bill) continue;
      let moved: { state: string; why?: string } | null = null;
      if (r.bill.status !== "open" && r.bill.status !== "paid" && r.bill.status !== "partially_paid") {
        moved = await advanceBill(String(row.zoho_bill_id));
        if (moved.state === "open") { opened++; r = await zohoFetch<{ bill?: ZohoBill }>(`/bills/${row.zoho_bill_id}`); }
      }
      if (r.bill) {
        await svc.from("provider_bills").update({
          zoho_echo: { ...echoOf(r.bill), ...(moved && moved.state !== "open" ? { zoho_status: moved.state } : {}) },
          error: moved && moved.state !== "open" ? `not in the ledgers yet — ${moved.why}` : null,
        }).eq("id", row.id);
      }
      checked++;
    } catch { /* one unreadable bill must not stop the rest */ }
  }
  return { checked, opened };
}

/**
 * CHECK A POSTED BILL'S DATE AGAINST THE PAPER, AND CORRECT IT.
 *
 * The first three bills went in while the reader still trusted the vault title,
 * which carries no date — so they were booked on the day they were FILED, and
 * the Rule-115 rate followed the wrong day with them. A bill's date decides its
 * GST period and its rupee value, so a wrong one is not cosmetic.
 *
 * This re-reads the invoice, and where it disagrees with what was booked it
 * moves the bill in Zoho to the invoice's own date at that date's rate.
 */
export async function recheckPostedBillDates(): Promise<string> {
  const svc = createServiceClient();
  const { data } = await svc.from("provider_bills")
    .select("id, institution, bill_no, bill_date, currency, amount, vault_doc_id, zoho_bill_id")
    .eq("status", "posted").not("zoho_bill_id", "is", null).limit(50);

  const notes: string[] = [];
  let fixed = 0;
  for (const row of data ?? []) {
    if (!row.vault_doc_id) continue;
    const { data: doc } = await svc.from("zoho_vault_docs").select("file_url").eq("id", row.vault_doc_id).maybeSingle();
    if (!doc?.file_url) continue;
    const text = await fetchText(String(doc.file_url)).catch(() => null);
    if (!text) { notes.push(`${row.bill_no}: could not read the PDF`); continue; }
    const { parseInvoiceText } = await import("@/lib/ai");
    const facts = await parseInvoiceText(text).catch(() => null);
    const real = str(facts?.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(real) || real === row.bill_date) continue;

    const currency = String(row.currency ?? "USD").toUpperCase();
    const total = Number(row.amount) || 0;
    let rate: number | null = null, rateDate: string | null = null;
    if (currency !== "INR") {
      const r = await rule115Rate(real, currency).catch(() => null);
      if (r) { rate = r.rate; rateDate = r.rateDate; }
    }
    try {
      await zohoFetch(`/bills/${row.zoho_bill_id}`, {
        method: "PUT",
        body: { date: real, ...(rate ? { exchange_rate: rate } : {}) },
      });
      await svc.from("provider_bills").update({
        bill_date: real, rate, rate_date: rateDate,
        inr_amount: rate ? Number((total * rate).toFixed(2)) : total,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      fixed++;
      notes.push(`${row.bill_no}: ${row.bill_date} → ${real}${rate ? ` @ ₹${rate}` : ""}`);
    } catch (e) {
      notes.push(`${row.bill_no}: should be ${real} but Zoho refused the change — ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
  return fixed || notes.length
    ? `${fixed} bill date(s) corrected. ${notes.join(" · ")}`
    : "Every posted bill already carries its own invoice date.";
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
      // Zoho decides the whole GST shape of a bill from these three, and will
      // refuse the reverse charge outright unless the transaction says it is an
      // import: the treatment, the flag, and the state supplied INTO.
      ...(overseas
        ? { gst_treatment: "overseas", is_reverse_charge_applied: true, destination_of_supply: HOME_STATE }
        : { gst_treatment: "business_gst" }),
      line_items: [{
        name: `${b.institution} services`,
        account_id: accountId,
        rate: total,
        quantity: 1,
        // Under reverse charge the supplier charges NOTHING — Vercel's invoice
        // carries no GST. The tax is self-assessed, so it goes on the reverse
        // charge field. Putting it in tax_id would both inflate what he owes the
        // vendor and misstate the liability.
        ...(taxId ? (overseas ? { reverse_charge_tax_id: taxId } : { tax_id: taxId }) : {}),
      }],
      notes: `${b.institution} invoice ${str(b.bill_no)} · ${currency} ${total}` +
        (rate ? ` @ ₹${rate} (SBI TT buy ${b.rate_date}, Rule 115)` : "") +
        ` · GST: ${p.gst_treatment}` +
        (p.tds_section ? ` · TDS ${p.tds_section} @ ${p.tds_rate}%` : " · no TDS"),
    };

    // THE DESK AND THE STANDING RULING HAVE TO AGREE.
    //
    // The founder ruled no TDS on foreign vendors, which is right wherever the
    // treaty carries a make-available test. Where it does not — Slovenia is the
    // live case — the desk works out that withholding IS due. Booking the bill
    // without it would risk the whole expense being disallowed, and quietly
    // overriding his ruling is not the desk's place either. So it stops and
    // asks which stands.
    const det = b.determination as { tdsRate?: number | null; tdsLabel?: string; why?: string } | null;
    if (det && Number(det.tdsRate) > 0 && !p.tds_section) {
      return fail(
        `the desk works out ${det.tdsLabel} withholding on this one, but your standing ruling for foreign vendors is no TDS. ` +
        `Which stands? Set a TDS section on the vendor to withhold, or record the ruling to post it at nil.`,
      );
    }

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

    const r = await zohoFetch<{ bill?: ZohoBill }>("/bills", { method: "POST", body });
    if (!r.bill?.bill_id) return fail("Zoho did not return the created bill");

    // Draft → Open. A draft bill in Zoho is a piece of paper, not an entry: it
    // reaches no ledger, no expense, no GST return. Creating one is only half
    // the posting.
    const moved = await advanceBill(r.bill.bill_id);

    await svc.from("provider_bills").update({
      status: "posted", zoho_bill_id: r.bill.bill_id, zoho_vendor_id: vendorId,
      rate, inr_amount: rate ? Number((total * rate).toFixed(2)) : total,
      zoho_echo: { ...echoOf(r.bill), zoho_status: moved.state },
      error: tdsNote || (moved.state === "open" ? null : `not in the ledgers yet — ${moved.why}`),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    // The vault copy is now worked, not raw.
    if (b.vault_doc_id) await svc.from("zoho_vault_docs").update({ is_processed: true }).eq("id", b.vault_doc_id);
  } catch (e) {
    if (e instanceof Error && /treatment|total|Rule-115/.test(e.message)) throw e;
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}
