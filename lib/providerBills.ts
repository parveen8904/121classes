import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";
import { taxId } from "@/lib/zohoLookup";
import { lineNarration } from "@/lib/zohoNarration";
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
  /** What the document IS, and how the withholding is met — asked once per
   *  supplier, and the reason the same invoice can be an expense, an asset or
   *  his own spending. */
  nature?: string | null; operating?: string | null; sub_account?: string | null;
  tds_mode?: string | null; supplier_kind?: string | null;
  /** Zoho tax to apply — "GST18" for an intra-state supplier, "IGST18" for
   *  inter-state or an import. Blank falls back to IGST<rate>. */
  gst_tax_name?: string | null;
  /** WHICH of Zoho's TDS rates, chosen from its real master. Zoho names them by
   *  the nature of the payment and the desk names sections, so this cannot be
   *  worked out — it is picked once and kept. See lib/tdsMatch.ts. */
  tds_tax_id?: string | null; tds_tax_name?: string | null;
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
/**
 * ONE SUPPLIER, HOWEVER THEIR NAME WAS TYPED.
 *
 * The FIRST FLY invoice was re-uploaded as "First Fly Express" where the
 * original said "FIRST FLY EXPRESS", and every institution comparison in this
 * file was exact — so the same courier ended up with two treatment rules, and
 * would have drifted into two of everything. Case and spacing are not
 * identity; this key is what every comparison uses now.
 */
export const instKey = (v: string | null | undefined): string =>
  String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export async function redetermineWaiting(institution: string): Promise<number> {
  const svc = createServiceClient();
  // ilike with no wildcard is exact-but-case-insensitive in PostgREST — the
  // same vendor's bills may carry either spelling, and both must be re-worked.
  const { data: ruleRows0 } = await svc.from("provider_bill_rules").select("*");
  const rule = (ruleRows0 ?? []).find((r) => instKey(String(r.institution)) === instKey(institution)) ?? null;
  if (!foreignAnswered(rule as Partial<BillRule>)) return 0;

  const { data: rows } = await svc.from("provider_bills")
    .select("id, institution, bill_date, inr_amount, currency, amount")
    .ilike("institution", institution).in("status", ["needs_info", "draft"]);

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
 * What the scanner needs off a vault document.
 *
 * It used to ask for five columns — id, title, institution, file_url,
 * created_at — and then RE-READ the paper from scratch. On a picture-only PDF
 * that second read gets nothing at all, so the bill was raised blank: no
 * invoice number, no invoice date, no figures.
 *
 * Meanwhile the vault had already read it. Filing runs readDocument, which
 * takes a picture invoice apart with the model and stores what it found:
 * doc_no, doc_date, party_gstin and the table itself in rows_json. All of it
 * sat one column away and was ignored.
 *
 * That is why every Bansal and Warehouse Pitam pura bill came through empty
 * while the vault screen showed "no. BSTI/26-27/16282 · 26 August 2026" in as
 * many words, and why the duplicate guard never fired on three copies of one
 * invoice — it keys on the invoice number, and the number was always null.
 */
const VAULT_COLS = "id, title, institution, file_url, created_at, doc_no, doc_date, party_gstin, rows_json, doc_text";


/**
 * Queue every vault invoice that is not queued yet: read its figures, convert
 * a foreign one at its Rule-115 rate, and propose the treatment when the vendor
 * already has a rule. Returns a human summary.
 */
export async function scanVaultForBills(limit = 3): Promise<string> {
  const svc = createServiceClient();

  // WHICH VAULT DOCUMENTS ARE INVOICES — BOTH WAYS OF SAYING SO.
  //
  // This asked for doc_type = "Invoice / bill", which is the exact string the
  // OLD upload form on the Invoices page writes. The vault's two-step flow
  // (2 September) records the answer as kind = "invoice" instead, and sets
  // doc_type from the free-text "if something else, what?" box. The two
  // vocabularies never met.
  //
  // So from 2 September every invoice filed through the vault was invisible
  // here: it sat in the list with an INVOICE badge, no bill was ever raised
  // from it, and there was nothing to send for approval. The desk's report of
  // 3 September — "there is no option to send for approval, so that's why we
  // are unable to post in zoho" — is exactly this, and the screenshot shows
  // three of them stranded.
  //
  // Asked as two queries rather than one `or`, because the old value contains
  // a space and a slash and PostgREST filter quoting is a poor thing to stake
  // a supplier's bill on.
  const [byKind, byType] = await Promise.all([
    svc.from("zoho_vault_docs").select(VAULT_COLS).eq("kind", "invoice"),
    svc.from("zoho_vault_docs").select(VAULT_COLS).eq("doc_type", "Invoice / bill"),
  ]);
  const seenDoc = new Set<string>();
  const docs = [...(byKind.data ?? []), ...(byType.data ?? [])]
    .filter((d) => (seenDoc.has(String(d.id)) ? false : (seenDoc.add(String(d.id)), true)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const { data: queued } = await svc.from("provider_bills").select("vault_doc_id");
  const have = new Set((queued ?? []).map((q) => String(q.vault_doc_id)));
  const { data: ruleRows } = await svc.from("provider_bill_rules").select("*");
  // Keyed on the normalised name, so "First Fly Express" finds the rule saved
  // as "FIRST FLY EXPRESS" instead of founding a dynasty of duplicates.
  const rules = new Map((ruleRows ?? []).map((r) => [instKey(String(r.institution)), r as BillRule]));

  // READ A FEW AT A TIME, AND SAY WHAT IS LEFT.
  //
  // Each invoice costs a signed URL, a download, a PDF text extract and one
  // small AI call; two dozen of those in a single request runs past the
  // serverless limit and the whole scan dies with nothing to show for it —
  // which is exactly what happened on the first press. So it takes a batch,
  // reports the remainder, and is pressed again. The batch is SMALL because
  // every invoice is now genuinely read rather than guessed from its title.
  const pending = docs.filter((d) => !have.has(String(d.id)));
  const batch = pending.slice(0, limit);

  let added = 0, asked = 0, dupes = 0;
  for (const d of batch) {
    // Where a rule already exists for this supplier, its spelling WINS: the
    // bill is stored under the rule's name, so however the upload was typed,
    // everything of one supplier converges on one string.
    const typed = str(d.institution) || "Unknown";
    const knownRule = rules.get(instKey(typed));
    const institution = knownRule ? String(knownRule.institution) : typed;

    let facts: { invoice_no?: string; date?: string; currency?: string; tax?: number; total?: number;
                 taxable_value?: number; cgst?: number; sgst?: number; igst?: number } = {};
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

    // WHAT THE VAULT ALREADY READ COUNTS AS READING THE INVOICE.
    //
    // The number and the date are transcribed off the paper by the filing
    // step, so they are the invoice's OWN, not a label and not today's date.
    // They beat the title on both — a title never carries the invoice date,
    // and every bill raised from a picture PDF was being stamped with the day
    // it happened to be filed.
    if (str(d.doc_no)) facts.invoice_no = str(d.doc_no);
    if (str(d.doc_date)) facts.date = str(d.doc_date);
    try {
      if (facts.total && facts.currency && facts.date) throw new Error("figures already known");

      // A picture invoice has no text layer, so fetchText returns nothing and
      // the figures went unread. The vault's rows_json IS the invoice's table,
      // taken off that picture — taxable value, CGST, SGST, total, all of it.
      // Rendered back to text it is exactly what parseInvoiceText wants, and
      // it costs no second look at the paper.
      //
      // This still READS the figures off the supplier's invoice. Nothing here
      // derives a tax from a rate: an invoice whose table nobody could read
      // goes on asking for the amount to be typed in.
      let text = await fetchText(str(d.file_url));
      if (!text) {
        const rows = Array.isArray(d.rows_json) ? (d.rows_json as unknown as string[][]) : null;
        if (rows?.length) {
          const { rowsToCsv } = await import("@/lib/rowsCsv");
          text = rowsToCsv(rows);
        } else if (str(d.doc_text)) text = str(d.doc_text);
      }
      if (text) {
        const { parseInvoiceText } = await import("@/lib/ai");
        const read = await parseInvoiceText(text);
        if (read) facts = { ...facts, ...read };
        // The paper's own number and date still win over a second-guess.
        if (str(d.doc_no)) facts.invoice_no = str(d.doc_no);
        if (str(d.doc_date)) facts.date = str(d.doc_date);
      }
    } catch { /* an unreadable PDF still queues — the figures can be typed in */ }

    // AN INVOICE NOBODY COULD READ IS NOT AN AMERICAN ONE.
    //
    // This defaulted to USD, and the default decided far more than a symbol:
    // isForeign below is `currency !== "INR"`, so every invoice whose text the
    // AI failed to transcribe was routed to the FOREIGN VENDOR DESK. On 1
    // September that put "Warehouse Pitam pura" — a warehouse in Delhi — behind
    // a country picker that lists fourteen treaty countries and, correctly for
    // a foreign desk, no India. There was no answer the desk could give.
    //
    // The earlier default was INR and that was wrong too: it booked twelve
    // Bunny invoices as rupees. Both defaults guess. An unread currency is
    // UNKNOWN, and unknown means a person types it — which the rest of this
    // function is already built for, since the amount and the GST breakup are
    // left null on the same principle.
    const readCurrency = str(facts.currency).toUpperCase();
    const currency = readCurrency || "";
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
    // Only convert what we actually know the currency of.
    if (currency && currency !== "INR" && total) {
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
    const rule = rules.get(instKey(institution));
    // A FOREIGN invoice needs more than an expense account. Until the desk has
    // answered where the vendor is, what they actually did and what papers are
    // on file, there is no way to know what to withhold — so it waits, even
    // when a treatment rule already exists.
    // Foreign only when the currency was actually READ and is not rupees. An
    // unknown currency waits for a human rather than being assumed either way.
    const isForeign = !!currency && currency !== "INR";
    const needsForeignAnswers = isForeign && !foreignAnswered(rule);

    // THE SAME INVOICE, UPLOADED TWICE, IS STILL ONE INVOICE.
    //
    // provider_bills.vault_doc_id is unique, so one DOCUMENT can only raise one
    // bill. That is not the same thing: the desk uploads the same PDF twice —
    // the screenshot of 3 September shows exactly that, "20260826 BANSAL
    // BUSINESS CORPORATION.pdf" filed twice under Unfiled — and two documents
    // then raise two bills for one supplier invoice. Approve both and the cost
    // is in the books twice, the input credit is claimed twice, and the
    // supplier's ledger says we owe double.
    //
    // A supplier's invoice number is unique within that supplier by law, so it
    // is the right key. Only checked where the number was actually READ: a
    // blank one would otherwise gather every unreadable invoice from that
    // vendor into a single "duplicate".
    const billNo = str(facts.invoice_no);
    if (billNo) {
      // A SKIPPED BILL IS NOT A DUPLICATE — IT IS ONE DELIBERATELY NOT BOOKED.
      //
      // FIRST FLY EXPRESS 480/2026 sits skipped with the note "the Zoho bill
      // this pointed at was deleted on 26 Aug — the invoice is being uploaded
      // again". Blocking on it would refuse the very re-upload it is waiting
      // for, and file the new copy as a duplicate of a bill that no longer
      // exists in Zoho. Same for anything the desk removed by hand and later
      // changed its mind about.
      // Matched on the NORMALISED supplier name, not the exact string. This
      // office writes one supplier three ways — "FIRST FLY EXPRESS" and
      // "First Fly Express" are both in the table for invoice 480/2026 — and
      // an exact comparison would have called them different vendors and let
      // the same invoice through twice. instKey is what the rest of this file
      // already uses for the same reason.
      const { data: sameNo } = await svc.from("provider_bills")
        .select("id, status, institution, vault_doc_id")
        .eq("bill_no", billNo)
        .not("status", "in", "(skipped,rejected)");
      const twin = (sameNo ?? []).find((b) => instKey(String(b.institution)) === instKey(institution));
      if (twin) {
        // Filed, not raised. The document stays in the vault as the second copy
        // of a paper we already have, and the desk is told which bill it is —
        // rather than the row silently going missing.
        await svc.from("zoho_vault_docs").update({
          is_processed: true,
          note: `Duplicate of ${institution} invoice ${billNo}, already on the Invoices page — no second bill raised.`,
        }).eq("id", d.id);
        dupes++;
        continue;
      }
    }

    const { data: madeRow } = await svc.from("provider_bills").insert({
      vault_doc_id: d.id, institution,
      bill_no: str(facts.invoice_no) || null, bill_date: billDate,
      currency, amount: total, tax_amount: Number(facts.tax) || null,
      // THE GST BREAKUP, WHERE THE INVOICE ACTUALLY PRINTED IT.
      //
      // "If you are unable to read any invoice, just leave the amount, we will
      // fill in [the rest]." So this copies across only what was genuinely read
      // and leaves the rest null — a null here means a person types it, which
      // is the intended outcome, not a failure. Nothing is computed: a bill
      // that arrives without these simply waits, and neither the preview nor
      // the posting will invent them (see lib/entryPreview.ts).
      taxable_value: Number(facts.taxable_value) || null,
      cgst_amount: Number(facts.cgst) || null,
      sgst_amount: Number(facts.sgst) || null,
      igst_amount: Number(facts.igst) || null,
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
    }).select("id").maybeSingle();
    if (isZero) continue;

    // READ THE PAPER PROPERLY, ON EVERY INVOICE.
    //
    // Above, the PDF is opened only when the TITLE has not already given the
    // total, currency and date — a shortcut that means a well-titled invoice is
    // never actually read. That is why 25 bills reached the books with not one
    // taxable value or GST amount between them, and why the vendor was a bare
    // name: nothing had ever looked at the document.
    //
    // So the full read runs here regardless. It transcribes the tax as printed,
    // the supplier's GSTIN, state, address and phone, and their Udyam number
    // where they print one. One AI call per invoice, against a bill that will
    // otherwise sit waiting for somebody to type it all in by hand.
    if (madeRow?.id) {
      try {
        const { readAndStore } = await import("@/lib/invoiceTax");
        const r = await readAndStore(String(madeRow.id));
        const t = r.tax;
        // WHERE THE READ FOOTS, IT IS THE ANSWER — not a suggestion.
        //
        // These figures are transcribed off the invoice, which is exactly what
        // his rule asks for, so filling them in is not "deriving" anything.
        // The safety is the arithmetic: the parts must add back to the invoice
        // total within a rupee. If they do not, they stay a proposal and a
        // person decides, which is the same line the editor draws.
        if (t && t.taxable_value !== null) {
          const parts = t.taxable_value + (t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0);
          const against = t.total ?? total ?? 0;
          if (against > 0 && Math.abs(parts - against) <= 1) {
            await svc.from("provider_bills").update({
              taxable_value: t.taxable_value,
              cgst_amount: t.cgst, sgst_amount: t.sgst, igst_amount: t.igst,
            }).eq("id", madeRow.id);
          }
        }
      } catch { /* an unreadable invoice still queues — it is typed in by hand */ }
    }

    if (rule && dated && total && !mismatch && !needsForeignAnswers) added++; else asked++;
  }
  const left = pending.length - batch.length;
  return `${added + asked + dupes} invoice(s) read — ${added} proposed from a remembered rule, ${asked} waiting for a treatment.` +
    // Not "waiting for a treatment": nothing is waiting. The paper is a second
    // copy of one we already hold, and saying so is what stops somebody
    // hunting the Invoices page for a bill that was never meant to appear.
    (dupes > 0 ? ` ${dupes} was a second copy of an invoice already on the list — filed, not raised again.` : "") +
    (left > 0 ? ` ${left} still to read — press again.` : " Vault fully read.");
}

/** Save the treatment for a vendor and re-propose every waiting invoice of theirs. */
export async function saveBillRule(rule: BillRule): Promise<number> {
  const svc = createServiceClient();
  // ONE RULE PER SUPPLIER. An upsert keyed on the exact string made
  // "First Fly Express" a second rule beside "FIRST FLY EXPRESS". If a rule
  // already exists under any spelling, THAT row is updated and its spelling
  // kept — the earliest spelling is the canonical one.
  const { data: allRules } = await svc.from("provider_bill_rules").select("institution");
  const existing = (allRules ?? []).find((r) => instKey(String(r.institution)) === instKey(rule.institution));
  const canonical = existing ? String(existing.institution) : rule.institution;
  await svc.from("provider_bill_rules").upsert(
    { ...rule, institution: canonical, updated_at: new Date().toISOString() }, { onConflict: "institution" });
  const { data: waiting } = await svc.from("provider_bills")
    .select("id").ilike("institution", rule.institution).eq("status", "needs_info");
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
/**
 * The fields Zoho needs on an INDIAN vendor.
 *
 * gst_treatment must be stated: "business_gst" with a GSTIN, otherwise
 * "business_none" for an unregistered supplier. place_of_contact is the state,
 * and it is the one that settles CGST/SGST against IGST.
 */
function indianVendorFields(facts: VendorFacts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const gstin = String(facts.gstin ?? "").trim().toUpperCase();
  const poc = placeOfContact(facts);
  if (gstin) { out.gst_no = gstin; out.gst_treatment = "business_gst"; }
  if (poc) out.place_of_contact = poc;
  if (facts.phone) out.phone = String(facts.phone).slice(0, 50);
  if (facts.email) out.email = String(facts.email).slice(0, 100);
  if (facts.address) {
    out.billing_address = {
      address: String(facts.address).slice(0, 250),
      ...(poc ? { state_code: poc } : {}),
      country: "India",
    };
  }
  return out;
}

/** The supplier's own particulars, read off their invoice. */
export type VendorFacts = {
  gstin?: string | null; state?: string | null; address?: string | null;
  phone?: string | null; email?: string | null;
  /** Udyam registration and size, where the invoice printed them. */
  udyam?: string | null; msmeType?: string | null;
};

/**
 * Zoho's two-letter place of supply, from a state name.
 *
 * This is the field that decides intra-state against inter-state, and with it
 * missing Zoho falls back to the organisation's own state and guesses. That
 * guess is how a CGST/SGST invoice went up as IGST and was refused.
 */
const STATE_CODE: Record<string, string> = {
  "andaman and nicobar islands": "AN", "andhra pradesh": "AP", "arunachal pradesh": "AR",
  assam: "AS", bihar: "BR", chandigarh: "CH", chhattisgarh: "CG",
  "dadra and nagar haveli and daman and diu": "DD", delhi: "DL", "new delhi": "DL",
  goa: "GA", gujarat: "GJ", haryana: "HR", "himachal pradesh": "HP",
  "jammu and kashmir": "JK", jharkhand: "JH", karnataka: "KA", kerala: "KL",
  ladakh: "LA", lakshadweep: "LD", "madhya pradesh": "MP", maharashtra: "MH",
  manipur: "MN", meghalaya: "ML", mizoram: "MZ", nagaland: "NL", odisha: "OD",
  orissa: "OD", puducherry: "PY", punjab: "PB", rajasthan: "RJ", sikkim: "SK",
  "tamil nadu": "TN", telangana: "TS", tripura: "TR", "uttar pradesh": "UP",
  uttarakhand: "UK", "west bengal": "WB",
};

/** The first two digits of a GSTIN are the state, and are more reliable than prose. */
const GSTIN_STATE: Record<string, string> = {
  "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL",
  "08": "RJ", "09": "UP", "10": "BR", "11": "SK", "12": "AR", "13": "NL", "14": "MN",
  "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH", "21": "OD",
  "22": "CG", "23": "MP", "24": "GJ", "26": "DD", "27": "MH", "29": "KA", "30": "GA",
  "31": "LD", "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AP",
  "38": "LA",
};

export function placeOfContact(facts: VendorFacts): string | null {
  const g = String(facts.gstin ?? "").trim();
  if (g.length >= 2 && GSTIN_STATE[g.slice(0, 2)]) return GSTIN_STATE[g.slice(0, 2)];
  const st = String(facts.state ?? "").trim().toLowerCase();
  return STATE_CODE[st] ?? null;
}

/** The PAN inside a GSTIN — characters 3 to 12. Two GSTINs of one business
 *  across states share a PAN, which is why it is the second-best key. */
export const panOf = (gstin: string | null | undefined): string | null => {
  const g = String(gstin ?? "").toUpperCase().replace(/\s/g, "");
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(g) ? g.slice(2, 12) : null;
};

const squash = (v: string | null | undefined) =>
  String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

type ZContact = {
  contact_id: string; contact_name: string; contact_type?: string;
  currency_code?: string; gst_no?: string; phone?: string; email?: string;
  billing_address?: { address?: string };
};

/** Ask Zoho for candidates by name AND by GSTIN, since either may find them. */
async function candidateContacts(name: string, gstin: string | null, type: "vendor" | "customer"): Promise<ZContact[]> {
  const seen = new Map<string, ZContact>();
  const add = (list: ZContact[] | undefined) => {
    for (const c of list ?? []) if (!seen.has(c.contact_id)) seen.set(c.contact_id, c);
  };
  const byName = await zohoFetch<{ contacts?: ZContact[] }>(
    "/contacts", { query: { contact_name: name, contact_type: type } }).catch(() => null);
  add(byName?.contacts);
  if (gstin) {
    const byGst = await zohoFetch<{ contacts?: ZContact[] }>(
      "/contacts", { query: { search_text: gstin, contact_type: type } }).catch(() => null);
    add(byGst?.contacts);
  }
  return [...seen.values()];
}

/**
 * WHICH OF THEM IS ACTUALLY THIS PARTY.
 *
 * His instruction, 26 Aug 2026: "there can be two vendors by same name so
 * always check with GST or PAN or address before journalising."
 *
 * He is right, and matching on the name alone was how it worked. Two firms
 * called "Sharma & Co" are two firms, and posting one's bill against the
 * other's ledger is money in the wrong account and a return that will not tie.
 *
 * So identity is settled in this order, strongest first:
 *   1. GSTIN — the registration itself. Nothing beats it.
 *   2. PAN — the same business registered in another state.
 *   3. Address or phone, where neither side has a GSTIN.
 *   4. A single name match carrying NO GSTIN of its own, which is the ordinary
 *      case of a contact somebody typed in by hand before this existed.
 *
 * A name that matches while the GSTIN does not is treated as a DIFFERENT
 * party, which is the whole point of his instruction.
 */
export function pickContact(
  cands: ZContact[], name: string, facts: VendorFacts,
): { hit: ZContact | null; why: string; conflict: boolean } {
  const gstin = String(facts.gstin ?? "").toUpperCase().replace(/\s/g, "") || null;
  const pan = panOf(gstin);

  if (gstin) {
    const byGst = cands.find((c) => squash(c.gst_no) === squash(gstin));
    if (byGst) return { hit: byGst, why: "GSTIN", conflict: false };
  }
  if (pan) {
    const byPan = cands.find((c) => panOf(c.gst_no) === pan);
    if (byPan) return { hit: byPan, why: "PAN", conflict: false };
  }

  const sameName = cands.filter((c) => squash(c.contact_name) === squash(name));

  if (facts.address || facts.phone) {
    const byPlace = sameName.find((c) =>
      (facts.phone && squash(c.phone) && squash(c.phone).includes(squash(facts.phone).slice(-10))) ||
      (facts.address && squash(c.billing_address?.address) &&
        squash(c.billing_address?.address).slice(0, 24) === squash(facts.address).slice(0, 24)));
    if (byPlace) return { hit: byPlace, why: "address or phone", conflict: false };
  }

  // A name match whose GSTIN differs is somebody else trading under the same
  // name. Never journalise against them.
  const blank = sameName.filter((c) => !squash(c.gst_no));
  if (gstin && sameName.length && !blank.length) {
    return { hit: null, why: "same name but a different GSTIN", conflict: true };
  }
  if (blank.length === 1) return { hit: blank[0], why: "name (no GSTIN on file)", conflict: false };
  if (blank.length > 1) {
    return { hit: null, why: `${blank.length} contacts share this name and none carries a GSTIN`, conflict: true };
  }
  return { hit: null, why: "no match", conflict: false };
}

/**
 * The vendor, identified properly and completed where Zoho is missing details.
 *
 * "If you find any vendor has missing details, that should be completed on
 * Zoho automatically." So a contact we identify as this party has its blanks
 * filled from the invoice. It only ever FILLS: a value already in Zoho is left
 * alone, because their books may hold something better than one invoice does.
 */
/**
 * PUT THE SUPPLIER'S MSME REGISTRATION ON THEIR ZOHO CONTACT.
 *
 * Section 43B(h): an expense owed to an MSME supplier is not deductible unless
 * it is paid within 45 days. Whether a supplier IS MSME is knowable only from
 * their own paper, and it is now read off it — but it is worth nothing sitting
 * in our database while the books, where the ageing actually lives, do not
 * know it.
 *
 * SENT ON ITS OWN, AND ALLOWED TO FAIL. Zoho exposes the MSME fields on a
 * contact only once MSME is switched on for the organisation, and his is
 * currently set to "not MSME registered". Folding these into the create call
 * would mean an unknown field could fail the whole contact and take the bill
 * down with it. So this is a separate best-effort write: when the org is not
 * ready for it, nothing is lost but the extra field, and the moment he
 * switches MSME on it starts landing without another line of code.
 */
async function applyMsme(contactId: string, facts: VendorFacts): Promise<string> {
  const udyam = String(facts.udyam ?? "").trim();
  if (!udyam) return "";
  try {
    await zohoFetch(`/contacts/${contactId}`, {
      method: "PUT",
      body: {
        msme_registered: true,
        msme_type: facts.msmeType ? String(facts.msmeType).toLowerCase() : "udyam",
        msme_registration_number: udyam,
      },
    });
    return ` — MSME ${udyam} recorded on the vendor`;
  } catch {
    // Almost always "MSME is not enabled for this organisation", which is a
    // setting, not a fault. Said plainly rather than swallowed.
    return ` — the supplier prints Udyam ${udyam}; Zoho would not take it (switch MSME on in Settings → Taxes & Compliance → MSME Settings and it will attach by itself)`;
  }
}

async function findOrCreateVendor(
  name: string, overseas: boolean, currency: string, facts: VendorFacts = {},
): Promise<{ id: string; note: string }> {
  const gstin = String(facts.gstin ?? "").toUpperCase().replace(/\s/g, "") || null;
  const cands = await candidateContacts(name, gstin, "vendor");
  const { hit, why, conflict } = pickContact(cands, name, facts);
  const wantCurrency = overseas && currency !== "INR" ? currency : null;
  const wanted = !overseas ? indianVendorFields(facts) : {};

  if (hit) {
    const patch: Record<string, unknown> = {};
    // Only the blanks. Never overwrite what their books already say.
    for (const [k, v] of Object.entries(wanted)) {
      const existing = (hit as unknown as Record<string, unknown>)[k];
      const empty = existing === undefined || existing === null || existing === "" ||
        (k === "billing_address" && !squash((existing as { address?: string })?.address));
      if (empty) patch[k] = v;
    }
    if (wantCurrency && hit.currency_code && hit.currency_code !== wantCurrency) {
      const cid = await currencyIdFor(wantCurrency);
      if (cid) { patch.currency_id = cid; patch.gst_treatment = "overseas"; }
    }
    if (Object.keys(patch).length) {
      try { await zohoFetch(`/contacts/${hit.contact_id}`, { method: "PUT", body: patch }); }
      catch { /* the bill will report it if Zoho still cannot place them */ }
    }
    const msme = await applyMsme(hit.contact_id, facts);
    return {
      id: hit.contact_id,
      note: (Object.keys(patch).length
        ? ` — matched the vendor on ${why} and filled in ${Object.keys(patch).join(", ")}`
        : ` — matched the vendor on ${why}`) + msme,
    };
  }

  // A genuine second party under a name Zoho already holds. Zoho requires the
  // contact name to be unique, so theirs is distinguished by their own GSTIN
  // rather than being merged into somebody else's ledger.
  const distinct = conflict && gstin ? `${name} (${gstin})` : name;
  const cid = wantCurrency ? await currencyIdFor(wantCurrency) : null;
  const made = await zohoFetch<{ contact?: { contact_id: string } }>("/contacts", {
    method: "POST",
    body: {
      contact_name: distinct, contact_type: "vendor",
      // An overseas supplier must be marked as such or Zoho refuses the reverse
      // charge outright ("should be applied on import of services…").
      ...(overseas ? { gst_treatment: "overseas" } : {}),
      ...(cid ? { currency_id: cid } : {}),
      // An Indian supplier needs their GSTIN and their state, or Zoho cannot
      // tell an intra-state bill from an inter-state one.
      ...wanted,
    },
  });
  if (!made.contact?.contact_id) throw new Error("could not create the vendor");
  const msme = await applyMsme(made.contact.contact_id, facts);
  return {
    id: made.contact.contact_id,
    note: (conflict
      ? ` — Zoho already held "${name}" with ${why}, so this supplier was created separately as "${distinct}"`
      : " — vendor created from the invoice") + msme,
  };
}

// Shared and cached — see lib/zohoLookup.ts. Asking Zoho for the tax list on
// every bill is part of what tripped its per-minute limit.
const taxIdByName = (name: string) => taxId(name);

type ZohoBill = {
  bill_id: string; vendor_name?: string; currency_code?: string; exchange_rate?: number;
  sub_total?: number; tax_total?: number; total?: number; is_reverse_charge_applied?: boolean;
  gst_treatment?: string; status?: string;
  /** What Zoho itself holds against the bill — the only honest answer to
      "is the invoice attached?". Our POST returning 200 is not that answer. */
  documents?: { document_id?: string; file_name?: string }[];
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
    documents: Array.isArray(b.documents) ? b.documents.length : 0,
  };
}

/**
 * Ask Zoho what it holds against one bill and record the answer.
 *
 * Used after attaching a file, and to fill the answer in for bills posted
 * before any of this existed. It is a read — it changes nothing in the books —
 * so it needs no approval, and it must never throw into whatever called it.
 */
export async function refreshBillEcho(id: string, zohoBillId: string): Promise<number | null> {
  try {
    const r = await zohoFetch<{ bill?: ZohoBill }>(`/bills/${zohoBillId}`);
    if (!r.bill) return null;
    const echo = echoOf(r.bill);
    await createServiceClient().from("provider_bills").update({ zoho_echo: echo }).eq("id", id);
    return echo.documents;
  } catch { return null; }
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

/** Take one bill out of draft in Zoho. Runs only from a released approval. */
export async function openPostedBill(id: string): Promise<void> {
  const svc = createServiceClient();
  const { data: b } = await svc.from("provider_bills").select("zoho_bill_id").eq("id", id).maybeSingle();
  if (!b?.zoho_bill_id) throw new Error("that bill has no Zoho id");
  const moved = await advanceBill(String(b.zoho_bill_id));
  const r = await zohoFetch<{ bill?: ZohoBill }>(`/bills/${b.zoho_bill_id}`).catch(() => null);
  await svc.from("provider_bills").update({
    ...(r?.bill ? { zoho_echo: { ...echoOf(r.bill), ...(moved.state !== "open" ? { zoho_status: moved.state } : {}) } } : {}),
    error: moved.state === "open" ? null : `not in the ledgers yet — ${moved.why}`,
  }).eq("id", id);
  if (moved.state !== "open") throw new Error(moved.why ?? "the bill would not open");
}

/** Move a booked bill to the date its own invoice carries. Release-time only. */
export async function applyBillDateFix(id: string, date: string, rate: number | null): Promise<void> {
  const svc = createServiceClient();
  const { data: b } = await svc.from("provider_bills").select("zoho_bill_id, amount, currency").eq("id", id).maybeSingle();
  if (!b?.zoho_bill_id) throw new Error("that bill has no Zoho id");
  await zohoFetch(`/bills/${b.zoho_bill_id}`, {
    method: "PUT",
    body: { date, ...(rate ? { exchange_rate: rate } : {}) },
  });
  const total = Number(b.amount) || 0;
  await svc.from("provider_bills").update({
    bill_date: date, rate,
    inr_amount: rate ? Number((total * rate).toFixed(2)) : total,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
}

/**
 * Re-read posted bills from Zoho and record what it holds. READ ONLY — where a
 * bill is still a draft there, it is put to the founder for approval rather
 * than opened on the spot, because opening it changes his books.
 */
export async function readbackPostedBills(): Promise<{ checked: number; opened: number }> {
  const svc = createServiceClient();
  const { data } = await svc.from("provider_bills")
    .select("id, institution, bill_no, zoho_bill_id").eq("status", "posted").not("zoho_bill_id", "is", null).limit(50);
  let checked = 0, opened = 0;
  for (const row of data ?? []) {
    try {
      let r = await zohoFetch<{ bill?: ZohoBill }>(`/bills/${row.zoho_bill_id}`);
      if (!r.bill) continue;
      const stillDraft = r.bill.status !== "open" && r.bill.status !== "paid" && r.bill.status !== "partially_paid";
      if (stillDraft) {
        // Opening it would put it in the ledgers, so it is his call, not ours.
        const { requestApproval } = await import("@/lib/zohoApprovals");
        await requestApproval({
          kind: "bill_open", refTable: "provider_bills", refId: String(row.id),
          summary: `Take ${row.institution} ${row.bill_no ?? ""} out of draft in Zoho so it reaches the ledgers`,
          details: { zoho_bill_id: row.zoho_bill_id, zoho_status: r.bill.status },
        });
        opened++;
      }
      await svc.from("provider_bills").update({
        zoho_echo: echoOf(r.bill),
        error: stillDraft ? "still a draft in Zoho — waiting for your approval to open it" : null,
      }).eq("id", row.id);
      checked++;
    } catch { /* one unreadable bill must not stop the rest */ }
  }
  return { checked, opened };
}

/**
 * The ledger he chose — created if it is a name Zoho does not yet carry.
 *
 * Where it is created matters as much as that it exists: operating or not
 * decides whether a cost sits in the trading result or below it, and whether an
 * asset is current or fixed. That answer is only ever available at the moment
 * he names the ledger, so it is taken then.
 *
 * New ledgers carry the "(AI)" suffix, as agreed — nothing the team made by
 * hand is ever merged, renamed or reused.
 */
async function ledgerId(name: string, nature: string, operating: string): Promise<string> {
  const clean = String(name).trim();
  const r = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string }[] }>(
    "/chartofaccounts", { query: { search_text: clean, filter_by: "AccountType.All" } });
  const found = (r.chartofaccounts ?? []).find(
    (a) => a.account_name.trim().toLowerCase() === clean.toLowerCase());
  if (found) return found.account_id;

  const { zohoAccountType } = await import("@/lib/postingShape");
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

    // A DOMESTIC BILL DOES NOT POST UNTIL ITS TAX HAS BEEN READ OFF THE PAPER.
    //
    // The preview refuses to invent this, and the gate must refuse too — a
    // guard that only exists on the screen is not a guard. Where the supplier
    // charged GST, the taxable value and the CGST/SGST/IGST are what the
    // invoice says, and nothing here derives them from the rate.
    //
    // Reverse charge is exempt by its nature: an overseas supplier charges no
    // tax at all, so there is nothing on the invoice to read and the liability
    // is the one we self-assess.
    const claimsItc = p.gst_treatment === "domestic_itc" || p.gst_treatment === "itc";
    const statedTax = Number(b.cgst_amount ?? 0) + Number(b.sgst_amount ?? 0) + Number(b.igst_amount ?? 0);
    if (claimsItc && !(Number(b.taxable_value) > 0 && statedTax > 0)) {
      return fail(
        "the tax on this bill has not been read off the invoice — open it and key the taxable value and the CGST/SGST/IGST exactly as printed, then approve it again",
      );
    }

    // NOTHING POSTS ON A GUESSED CURRENCY. Falling back to USD here would take
    // an invoice whose paper nobody could read and book it in dollars at a
    // Rule-115 rate, in the books, under his approval. If it was never read,
    // it waits for a person — same rule as the tax breakup just above.
    const currency = str(b.currency);
    if (!currency) {
      return fail(
        "the currency on this bill was never read off the invoice — open it, set the currency and the amount as printed, then approve it again",
      );
    }
    const overseas = p.gst_treatment === "rcm";
    let rate = b.rate ? Number(b.rate) : null;
    if (currency !== "INR" && !rate) {
      const r = await rule115Rate(String(b.bill_date), currency);
      if (!r) return fail("no Rule-115 rate available for this date yet");
      rate = r.rate;
    }

    // THE VENDOR IS MADE PROPERLY, FROM THEIR OWN INVOICE.
    //
    // His reading of the failure, and it was right: "there is no vendor by the
    // name FIRST FLY EXPRESS in Zoho, and we don't send any GST or address of
    // the vendor… therefore the entry cannot be posted." A domestic vendor was
    // being created with a name and nothing else, so Zoho had no state to place
    // them in and fell back to ours.
    let vendorNote = "";
    const read = (b.tax_read ?? {}) as Record<string, unknown>;
    const vendorPick = await findOrCreateVendor(String(p.vendor_name), overseas, currency, {
      gstin: (read.vendor_gstin as string) ?? null,
      state: (read.vendor_state as string) ?? null,
      address: (read.vendor_address as string) ?? null,
      phone: (read.vendor_phone as string) ?? null,
      email: (read.vendor_email as string) ?? null,
      udyam: (read.vendor_udyam as string) ?? null,
      msmeType: (read.vendor_msme_type as string) ?? null,
    });
    const vendorId = vendorPick.id;
    // How the party was identified is recorded on the bill, because "matched on
    // GSTIN" and "matched on a name with no GSTIN" are not the same assurance.
    vendorNote = vendorPick.note;
    if (vendorId) {
      await svc.from("provider_bills").update({ zoho_vendor_id: vendorId }).eq("id", id);
    }
    // WHAT THIS DOCUMENT IS decides everything below it.
    const nature = String(b.nature ?? p.nature ?? "expense");
    const operating = String(b.operating ?? p.operating ?? "operating");
    const { zohoDocument, tdsWorking } = await import("@/lib/postingShape");
    const doc = zohoDocument(nature as never);

    // NOT EVERY ARRIVING PAPER IS A BILL. Income and liabilities become a
    // journal, a credit note we are giving becomes a credit note — each raised
    // through the same code that raises them from the desk itself, so there is
    // one way of making each document rather than two that can drift apart.
    if (doc !== "bill") {
      const inrNow = rate ? Number((total * rate).toFixed(2)) : total;
      const { data: made } = await svc.from("zoho_documents").insert({
        kind: doc === "vendor_credit" ? "vendor_credit" : doc,
        party_name: String(p.vendor_name ?? b.institution),
        doc_date: b.bill_date, doc_no: null,
        reference: str(b.bill_no) || null,
        description: `${b.institution} ${str(b.bill_no)}`.trim(),
        amount: total, currency, rate, inr_amount: inrNow,
        nature, operating, ledger: String(p.expense_account ?? ""),
        sub_account: b.sub_account ?? null,
        gst_treatment: p.gst_treatment === "none" ? "none" : "charged",
        gst_rate: Number(p.gst_rate ?? 18),
        journal_lines: doc === "journal" ? [
          // The money side against the head he chose. Which way round depends on
          // whether this is something earned or something owed.
          { account: "Razorpay Clearing", side: nature === "income" ? "debit" : "credit", amount: inrNow, note: "to be matched to the bank" },
          { account: String(p.expense_account ?? ""), side: nature === "income" ? "credit" : "debit", amount: inrNow,
            note: str(b.bill_no), nature, operating },
        ] : null,
      }).select("id").single();

      if (!made?.id) return fail("could not prepare that as a journal or credit note");
      const { postOutgoing } = await import("@/lib/zohoOutgoing");
      await postOutgoing(String(made.id));
      const { data: after } = await svc.from("zoho_documents").select("status, zoho_number, error").eq("id", made.id).maybeSingle();
      if (after?.status !== "posted") return fail(String(after?.error ?? "it would not post"));

      await svc.from("provider_bills").update({
        status: "posted", zoho_bill_id: null,
        rate, inr_amount: inrNow,
        error: `posted as a ${doc.replace("_", " ")}${after.zoho_number ? ` — ${after.zoho_number}` : ""}`,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (b.vault_doc_id) await svc.from("zoho_vault_docs").update({ is_processed: true }).eq("id", b.vault_doc_id);
      return;
    }
    let accountId = await ledgerId(String(p.expense_account), nature, operating);

    // THE SUB-LEDGER IS AN ACCOUNT, NOT A PHRASE IN THE DESCRIPTION.
    //
    // Same fault as the bank line, same fix (2 Sep 2026): the sub-account was
    // written into the line description and the bill still went to the parent
    // head, so nothing could be totalled by it. It now posts to a real Zoho
    // sub-account of that head, created once and reused.
    if (String(b.sub_account ?? "").trim()) {
      const { zohoSubAccount } = await import("@/lib/bankStatements");
      accountId = (await zohoSubAccount(String(p.expense_account), String(b.sub_account))).id;
    }

    // GST: reverse charge for an import of services; the charged tax for a
    // domestic bill; nothing when the vendor charges none.
    // Named per vendor where it matters: a Delhi supplier is CGST+SGST ("GST18"),
    // a Bengaluru one billing Delhi is IGST. Import of services is IGST too.
    // WHICH GST THE INVOICE ACTUALLY CHARGED — read, not assumed.
    //
    // This fell back to IGST whenever no tax name was set on the vendor rule,
    // and FIRST FLY has none. Its invoice prints CGST and SGST (a Delhi
    // supplier billing a Delhi business), so Zoho threw it straight back:
    // "IGST cannot be applied as this is an intrastate transaction".
    //
    // Now that the invoice is read, it answers the question itself. CGST or
    // SGST on the paper means intra-state; IGST means inter-state. An explicit
    // name on the rule still wins, because he may know something the paper
    // does not say.
    const keyedCgst = Number(b.cgst_amount ?? 0) + Number(b.sgst_amount ?? 0);
    const keyedIgst = Number(b.igst_amount ?? 0);
    const fromInvoice = keyedCgst > 0 ? `GST${Number(p.gst_rate ?? 18)}`
      : keyedIgst > 0 ? `IGST${Number(p.gst_rate ?? 18)}`
      : null;
    const taxName = p.gst_treatment === "none"
      ? null
      // An import of services is always IGST, whatever a foreign invoice shows.
      : overseas ? (str(p.gst_tax_name) || `IGST${Number(p.gst_rate ?? 18)}`)
      : (str(p.gst_tax_name) || fromInvoice || `IGST${Number(p.gst_rate ?? 18)}`);
    const taxId = taxName ? await taxIdByName(taxName) : null;

    // DEDUCTED OR BORNE. Where the tax is borne, the supplier must still receive
    // their full invoice, so the bill is raised at the grossed-up figure and the
    // withholding comes out of that — leaving the vendor exactly their amount.
    const tdsMode = String(b.tds_mode ?? p.tds_mode ?? (p.tds_section ? "deduct" : "none"));

    // TDS SITS ON THE TAXABLE VALUE, HERE TOO.
    //
    // This took the invoice TOTAL, so FIRST FLY posted ₹71 — 1% of ₹7,053 —
    // while the screen he approved, and the figure saved against the bill, both
    // said ₹60, being 1% of the taxable ₹5,977. GST charged separately on an
    // invoice is outside the TDS base; that is his rule and it was already
    // obeyed everywhere except the one place that writes to the books.
    //
    // Third time today the same shape: one number worked out in two places,
    // drifting apart. The base is chosen once, here, and matches the preview.
    const keyedTaxable = Number(b.taxable_value) > 0 ? Number(b.taxable_value) : null;
    const tdsBaseInr = keyedTaxable !== null
      // The keyed figure is in the invoice's own currency, so a foreign bill
      // converts it the same way the total is converted.
      ? (rate ? Number((keyedTaxable * rate).toFixed(2)) : keyedTaxable)
      : (rate ? Number((total * rate).toFixed(2)) : total);

    const work = tdsWorking(
      tdsBaseInr,
      tdsMode as never, Number(p.tds_rate ?? 0), String(p.vendor_name ?? b.institution),
    );
    // THE LINE IS THE TAXABLE VALUE, BECAUSE ZOHO ADDS THE GST ITSELF.
    //
    // This sent the invoice TOTAL as the line amount and attached the GST tax
    // id beside it, so Zoho added 18% on top of a figure that already included
    // it. FIRST FLY's ₹7,053 invoice went into his books as ₹8,252.01 — an
    // expense overstated by ₹1,076 and, worse, ₹1,269 of input credit claimed
    // that no supplier ever charged.
    //
    // It never showed on the foreign bills because those go up under reverse
    // charge, where the two tax lines cancel and the total is unaffected. The
    // first domestic bill to post is the first one that could be wrong.
    //
    // Where the invoice's taxable value has been read, that is the line and
    // Zoho computes the tax from it: 5,977 + 18% = 7,052.86, which is the
    // invoice. A domestic bill cannot reach here without it — the guard above
    // refuses to post one whose tax has not been read off the paper.
    const lineRate = tdsMode === "gross_up" && rate
      ? Number((work.bookedAmount / rate).toFixed(2))
      : (!overseas && keyedTaxable !== null ? keyedTaxable : total);

    const body: Record<string, unknown> = {
      vendor_id: vendorId,
      bill_number: str(b.bill_no) || `${b.institution}-${String(b.id).slice(0, 8)}`,
      date: b.bill_date,
      ...(str(b.bill_no) ? { reference_number: str(b.bill_no) } : {}),
      ...(currency !== "INR" ? { exchange_rate: rate } : {}),
      // Zoho decides the whole GST shape of a bill from these three, and will
      // refuse the reverse charge outright unless the transaction says it is an
      // import: the treatment, the flag, and the state supplied INTO.
      ...(overseas
        ? { gst_treatment: "overseas", is_reverse_charge_applied: true, destination_of_supply: HOME_STATE }
        : { gst_treatment: "business_gst" }),
      line_items: [{
        name: `${b.institution} — ${String(p.expense_account ?? "services")}`.slice(0, 100),
        // THE LEDGER SEES THIS, AND ONLY THIS.
        //
        // Notes below are full, but Zoho never prints them in Account
        // Transactions. Whoever reads the expense head — the auditor, the
        // department, or him in two years — gets the line description and
        // nothing else, so the whole entry goes in it: the vendor, the head,
        // their invoice and its date, the foreign figure with the rate, its
        // source and Rule 115, the GST treatment and the withholding.
        description: lineNarration({
          who: String(p.vendor_name ?? b.institution),
          what: String(p.expense_account ?? ""),
          subAccount: b.sub_account ?? null,
          docNo: str(b.bill_no), docDate: b.bill_date,
          currency, amount: total, rate, rateDate: b.rate_date,
          rateSource: currency !== "INR" && rate ? "SBI TT buy" : null,
          gst: p.gst_treatment, gstRate: Number(p.gst_rate ?? 18),
          tds: { section: p.tds_section ?? null, rate: Number(p.tds_rate ?? 0), amount: work.tds, mode: tdsMode },
        }),
        account_id: accountId,
        rate: lineRate,
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
    // AND SETTING THE RATE ON THE BILL IS HOW HE ANSWERS IT.
    //
    // This asked the question but did not recognise the answer. It fired
    // whenever the determination wanted TDS and no tds_section was set — so
    // opening the bill, setting the rate to nil, saving it and approving it
    // produced this same refusal every time, because "nil" was not a section.
    // Two Bunny bills failed at his gate on exactly that, after he had told the
    // form twice that no tax was to be withheld.
    //
    // An explicitly SET rate is his ruling, and zero is a ruling — it is the
    // whole of what "no TDS on foreign vendors" means. The question is only
    // worth asking while he has said nothing at all.
    // "NO GST" ON AN IMPORT IS NOT A POSITION ZOHO WILL ACCEPT.
    //
    // Zoho refused three of these with: "Specify either a Tax Exemption or
    // Reverse Charge." It is right to. A bill from a foreign supplier is an
    // import of service: under GST it carries reverse charge, where we
    // self-assess the tax and claim it straight back — the two legs cancel and
    // nothing is actually paid, which is why "no GST" feels equivalent and is
    // not. A zero-tax bill needs a REASON, and Zoho will only take one of two:
    // reverse charge, or a recorded exemption.
    //
    // Caught here rather than at Zoho, because the message Zoho sends back
    // names a field on a screen he never sees.
    if (currency !== "INR" && p.gst_treatment === "none") {
      return fail(
        `Zoho will not take a foreign bill marked "no GST": an import of service must carry reverse charge, ` +
        `or a recorded tax exemption. Open the bill and set GST to "Reverse charge — we pay it" — under reverse ` +
        `charge the two tax lines cancel, so nothing is paid either way, but the bill is then legal on the face of it.`,
      );
    }

    const det = b.determination as { tdsRate?: number | null; tdsLabel?: string; why?: string } | null;
    const ruledRate = p.tds_rate !== null && p.tds_rate !== undefined && String(p.tds_rate) !== "";
    const hasRuled = !!p.tds_section || ruledRate || p.tds_mode === "none";
    if (det && Number(det.tdsRate) > 0 && !hasRuled) {
      return fail(
        `the desk works out ${det.tdsLabel} withholding on this one, but your standing ruling for foreign vendors is no TDS. ` +
        `Which stands? Open the bill and set the TDS rate — nil to post it without withholding, or a rate and section to withhold.`,
      );
    }

    // TDS, where Zoho holds a matching tax. Where it does not, the bill still
    // posts and the row says the TDS must be applied by hand — never silently.
    let tdsNote = "";
    if (p.tds_section) {
      // "NO SUCH TAX" AND "I COULD NOT ASK" ARE NOT THE SAME ANSWER.
      //
      // FIRST FLY posted saying no matching TDS tax existed. A 1% rate DOES
      // exist in his Zoho — the lookup simply failed, and `.catch(() => null)`
      // turned that failure into an empty list, which reads as an absence. So
      // a bill went into the books with its withholding quietly detached, which
      // is a return that will not tie.
      //
      // A lookup that cannot be made now STOPS the posting. A bill can be
      // posted a minute later; a bill posted with the wrong tax treatment has
      // to be found and undone.
      let taxes: { tax_id: string; tax_name: string; tax_percentage: number }[] | null = null;
      try {
        // Reads the filtered list and, when that comes back empty, the whole
        // tax list — because filter_by=Taxes.Tds returned nothing on his org
        // while a 1% TDS was sitting in it. See lib/zohoTds.ts.
        const { listZohoTds } = await import("@/lib/zohoTds");
        taxes = await listZohoTds();
      } catch (e) {
        return fail(
          `could not read the TDS rates from Zoho, so this bill was not posted rather than posted without its ` +
          `${p.tds_rate}% withholding — ${e instanceof Error ? e.message : "unknown"}. Approve it again in a minute.`,
        );
      }
      // THIS USED TO GUESS, AND THE GUESS REACHED ZOHO.
      //
      // The line here was `t.tax_name.includes(section) || rate === rate` — an
      // OR — so a section that did not match verbatim fell through to the first
      // rate at the same percentage. On CMG & COMPANY that was Dividend under
      // 194, on a bill for professional fees, and expired as well; Zoho refused
      // it: "The tax Dividend associated ... is either expired or is applicable
      // for a future date". A right rate under the wrong section is a wrong
      // challan, and only Zoho's own validation stood between it and the books.
      //
      // matchTds has been in lib/zohoTds.ts all along, with a comment saying
      // exactly this must not be done. Use it. It is section-strict, judges the
      // rate's window against THIS BILL's date, and answers null rather than
      // substituting — which lands in the note below, where a person sees it.
      const { matchTds, tdsChoicesAt } = await import("@/lib/zohoTds");
      const onISO = String(b.bill_date ?? "").slice(0, 10);
      const match = matchTds(
        taxes, String(p.tds_section ?? ""), Number(p.tds_rate), onISO, str(p.tds_tax_id) || null);
      if (match) body.tds_tax_id = match.tax_id;
      else {
        // A WITHHOLDING THAT COULD NOT BE ATTACHED STOPS THE BILL.
        //
        // It used to post anyway with this as a note, and on 3 September that
        // is exactly what happened: CMG & COMPANY went into the books at
        // ₹88,500 with its ₹7,500 of TDS detached, because Zoho holds no rate
        // called "393(2) Sl.17" — it names its master by nature, not section.
        // FIRST FLY did the same on 26 August. A note nobody reads is not a
        // control, and TDS is money owed to the government with a due date on
        // it; a bill can wait a minute, a short-deducted return cannot be
        // quietly undone.
        //
        // So it refuses, and names the live rates at this very percentage so
        // the choice is one click rather than a hunt through twenty-odd.
        const choices = tdsChoicesAt(taxes, Number(p.tds_rate), onISO);
        return fail(
          `this bill withholds ${p.tds_rate}% under ${p.tds_section}, and Zoho has no rate of that name — it names its ` +
          `TDS master by the nature of the payment, not by section. Nothing was posted, because a bill booked with the ` +
          `withholding detached is a return that will not tie. ` +
          (choices.length
            ? `Pick the right one on the invoice and it will be remembered for ${b.institution}: ` +
              `${choices.map((t) => t.tax_name).join(", ")}.`
            : `Zoho holds no live rate at ${p.tds_rate}% on ${onISO} — add one under Settings → Taxes → TDS first.`),
        );
      }
    }

    const r = await zohoFetch<{ bill?: ZohoBill }>("/bills", { method: "POST", body });
    if (!r.bill?.bill_id) return fail("Zoho did not return the created bill");

    // Draft → Open. A draft bill in Zoho is a piece of paper, not an entry: it
    // reaches no ledger, no expense, no GST return. Creating one is only half
    // the posting.
    const moved = await advanceBill(r.bill.bill_id);

    // The supplier's own invoice, onto the bill it produced.
    let paper = "";
    if (b.vault_doc_id) {
      const { data: doc } = await svc.from("zoho_vault_docs").select("file_url, title").eq("id", b.vault_doc_id).maybeSingle();
      const { attachToZoho } = await import("@/lib/zohoAttach");
      const att = await attachToZoho("bill", r.bill.bill_id, doc?.file_url, `${b.institution}-${str(b.bill_no) || "invoice"}.pdf`);
      if (!att.ok) paper = ` — posted, but the invoice PDF is not attached (${att.note})`;
    }

    await svc.from("provider_bills").update({
      status: "posted", zoho_bill_id: r.bill.bill_id, zoho_vendor_id: vendorId,
      rate, inr_amount: rate ? Number((total * rate).toFixed(2)) : total,
      booked_amount: work.bookedAmount, tds_amount: work.tds, vendor_gets: work.vendorGets,
      zoho_echo: { ...echoOf(r.bill), zoho_status: moved.state },
      error: ((tdsNote || (moved.state === "open" ? "" : `not in the ledgers yet — ${moved.why}`)) + vendorNote + paper) || null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    // The vault copy is now worked, not raw.
    if (b.vault_doc_id) await svc.from("zoho_vault_docs").update({ is_processed: true }).eq("id", b.vault_doc_id);
  } catch (e) {
    if (e instanceof Error && /treatment|total|Rule-115/.test(e.message)) throw e;
    await fail(e instanceof Error ? e.message : "posting failed");
  }
}

/**
 * ATTACH THE INVOICE PDF TO A BILL ALREADY IN ZOHO — the executor behind the
 * `attach_paper` approval. Lifted out of attachPaperAction on 25 Aug 2026 so
 * that it runs from releaseApproval like every other write: his ruling, "make
 * attaching through the gate". It touches no ledger, but it changes what the
 * books show a posting to be, and one door is easier to guard than two.
 */
export async function attachBillPaper(billId: string): Promise<void> {
  const svc = createServiceClient();
  const { data: b } = await svc.from("provider_bills")
    .select("institution, bill_no, zoho_bill_id, vault_doc_id").eq("id", billId).maybeSingle();
  if (!b?.zoho_bill_id) throw new Error("that bill is not in Zoho yet, so there is nothing to attach to");
  if (!b.vault_doc_id) throw new Error("no invoice is filed against that bill in the vault");
  const { data: doc } = await svc.from("zoho_vault_docs").select("file_url").eq("id", b.vault_doc_id).maybeSingle();
  if (!doc?.file_url) throw new Error("the filed invoice has no file behind it");

  const { attachToZoho } = await import("@/lib/zohoAttach");
  const att = await attachToZoho("bill", String(b.zoho_bill_id), String(doc.file_url),
    `${b.institution}-${b.bill_no ?? "invoice"}.pdf`);
  await svc.from("provider_bills").update({
    paper_note: att.ok ? null : `the invoice is not attached (${att.note})`,
  }).eq("id", billId);
  // ASK ZOHO WHETHER IT ACTUALLY HAS THE FILE, rather than believing our own
  // upload — otherwise the row goes on offering to attach what is attached.
  if (att.ok) await refreshBillEcho(billId, String(b.zoho_bill_id));
  else throw new Error(att.note || "Zoho would not take the file");
}
