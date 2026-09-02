import Link from "next/link";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoConfigured } from "@/lib/zohoApi";
import { formatDate } from "@/lib/dates";
import { listZohoAccounts } from "@/lib/bankStatements";
import { FVD, KNOWN_FOREIGN_VENDORS } from "@/lib/foreignVendorDesk";
import SubmitButton from "@/app/components/SubmitButton";
import Money from "@/app/components/Money";
import PdfUpload from "../../_components/PdfUpload";
import RaiseDocument from "../RaiseDocument";
import EntryEditor from "../EntryEditor";
import DeskShell from "../_shell";
import {
  uploadBillAction, decideBillAction, removeBillAction, attachPaperAction, raiseDocumentAction,
  retryDocumentAction, saveForeignAnswersAction, markFormFiledAction, readInvoiceTaxAction,
  createTdsTaxAction, fetchProviderInvoicesAction, addVaultDoc,
} from "../actions";

// SUPPLIER INVOICES AND DOCUMENTS, on their own page.

export const dynamic = "force-dynamic";

export default async function InvoicesPage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";
  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];


  // Provider invoices waiting to become Zoho BILLS.
  type ProviderBillRow = { id: string; institution: string; bill_no: string | null; bill_date: string | null; currency: string; amount: number | null; inr_amount: number | null; rate: number | null; rate_date: string | null; status: string; proposal: { vendor_name?: string; expense_account?: string; gst_treatment?: string; gst_rate?: number;
      tds_section?: string | null; tds_rate?: number | null;
      // What the document is, and how the withholding is met — remembered per supplier.
      nature?: string | null; operating?: string | null; sub_account?: string | null;
      tds_mode?: string | null; supplier_kind?: string | null } | null; error: string | null;
    determination: { tdsLabel?: string; tdsRate?: number | null; confidence?: string; form145Part?: string | null; form146Required?: boolean; warnings?: string[]; certAdvice?: { why: string; points: string[] } | null; grossedUp?: number | null } | null;
    taxable_value: number | null; cgst_amount: number | null; sgst_amount: number | null; igst_amount: number | null;
    tax_read: { taxable_value: number | null; cgst: number | null; sgst: number | null; igst: number | null; total: number | null; note: string | null; vendor_name?: string | null; vendor_gstin?: string | null; vendor_state?: string | null; vendor_udyam?: string | null; vendor_msme_type?: string | null } | null;
    tds_amount: number | null; booked_amount: number | null };
  const { data: billData } = hubConnected
    ? await createServiceClient().from("provider_bills")
        .select("id, institution, bill_no, bill_date, currency, amount, inr_amount, rate, rate_date, status, proposal, error, determination, taxable_value, cgst_amount, sgst_amount, igst_amount, tds_amount, booked_amount, tax_read")
        .in("status", ["needs_info", "draft", "failed"]).order("bill_date")
    : { data: [] as never[] };
  const bills = (billData ?? []) as unknown as ProviderBillRow[];
  // What withholding Zoho can actually apply, against what our vendor rules
  // will ask for. A bill that posts with its TDS unattached is a return that
  // will not tie, and until now that only showed up after the fact.
  const { listZohoTds, tdsSectionsNeeded, matchTds } = await import("@/lib/zohoTds");
  const [zohoTds, tdsNeeded] = hubConnected
    ? await Promise.all([listZohoTds().catch(() => []), tdsSectionsNeeded().catch(() => [])])
    : [[], []];
  const tdsGaps = tdsNeeded.filter((n) => !matchTds(zohoTds, n.section, n.rate));
  // When no TDS rate is found, show what Zoho DOES hold — a rate filed under a
  // name we did not expect is the likeliest reason, and it is invisible unless
  // the list is on the screen.
  const allTaxNames = zohoTds.length
    ? []
    : (await (await import("@/lib/zohoTds")).listAllZohoTaxes().catch(() => []))
        .map((t) => `${t.tax_name} (${t.tax_percentage}%)`).slice(0, 20);
  // WHICH BILLS ARE ALREADY AT THE GATE. Not the gate itself — that is its own
  // page now — only the marker that says a card has been sent up, so the desk
  // does not send it twice.
  const { listPending } = await import("@/lib/zohoApprovals");
  const allPending = hubConnected ? await listPending() : [];
  const pendingBillIds = new Set(allPending.filter((a) => a.kind === "provider_bill").map((a) => String(a.ref_id)));

  const { data: ruleRows } = hubConnected
    ? await createServiceClient().from("provider_bill_rules").select("*")
    : { data: [] as never[] };
  type ForeignRule = { institution: string; country: string | null; service_category: string | null;
    billing_frequency: string | null; has_trc: boolean; has_form10f: boolean; has_no_pe: boolean;
    has_395_cert: boolean; expected_annual: number | null };

  type RaisedRow = { id: string; kind: string; status: string; party_name: string | null; doc_date: string;
    doc_no: string | null; zoho_number: string | null; description: string | null; inr_amount: number | null;
    ledger: string | null; gst_treatment: string; gst_rate: number | null; tds_rate: number | null; error: string | null };
  const { data: raisedData } = hubConnected
    ? await createServiceClient().from("zoho_documents")
        .select("id, kind, status, party_name, doc_date, doc_no, zoho_number, description, inr_amount, ledger, gst_treatment, gst_rate, tds_rate, error")
        .order("created_at", { ascending: false }).limit(25)
    : { data: [] as never[] };
  const raised = (raisedData ?? []) as unknown as RaisedRow[];

  // One list, one card each: everything that still needs a decision.
  const billsWaiting = bills
    .filter((b) => b.status === "needs_info" || b.status === "draft" || b.status === "failed")
    .sort((a, b) => String(a.bill_date ?? "").localeCompare(String(b.bill_date ?? "")));
  const allRules = (ruleRows ?? []) as unknown as (ForeignRule & {
    vendor_name?: string; expense_account?: string; gst_treatment?: string;
    gst_rate?: number; tds_section?: string | null; tds_rate?: number | null; gst_tax_name?: string | null })[];
  // Case-insensitive: "First Fly Express" must find the rule saved as
  // "FIRST FLY EXPRESS" — exact matching is how one courier got two rules.
  const instK = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();
  const ruleFor = (inst: string) => allRules.find((r) => instK(r.institution) === instK(inst));
  const seedFor = (inst: string) =>
    Object.entries(KNOWN_FOREIGN_VENDORS).find(([k]) => inst.toLowerCase().includes(k.toLowerCase()))?.[1];
  const fyNow = (() => {
    const now = new Date();
    const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
    const start = m < 4 ? y - 1 : y;
    return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  })();
  type PostedBillRow = {
    id: string; institution: string; bill_no: string | null; bill_date: string | null; error: string | null;
    zoho_echo: { currency?: string | null; total?: number | null; exchange_rate?: number | null;
      tax_total?: number | null; reverse_charge?: boolean | null; zoho_status?: string | null;
      documents?: number | null } | null;
    paper_note: string | null; vault_doc_id: string | null; zoho_bill_id: string | null;
  };
  const { data: billsPostedData } = hubConnected
    ? await createServiceClient().from("provider_bills")
        .select("id, institution, bill_no, bill_date, zoho_echo, error, paper_note, vault_doc_id, zoho_bill_id")
        .eq("status", "posted").order("bill_date", { ascending: false }).limit(50)
    : { data: [] as never[] };
  const billsPostedRows = (billsPostedData ?? []) as unknown as PostedBillRow[];

  // DOES ZOHO ACTUALLY HOLD THE INVOICE? ASK IT, ONCE, PER BILL.
  //
  // He attached the Vercel invoices, Zoho took them, and this page went on
  // offering to attach them — because a successful attach recorded nothing at
  // all. Bills posted before the desk started asking have no answer stored, so
  // they are asked here: a read, changing nothing in the books, capped at a
  // dozen a page and never repeated once an answer is in. A failure leaves the
  // row exactly as it was rather than claiming anything either way.
  const paperUnknown = billsPostedRows.filter(
    (r) => r.zoho_bill_id && (r.zoho_echo?.documents === undefined || r.zoho_echo?.documents === null),
  ).slice(0, 12);
  if (paperUnknown.length) {
    const { refreshBillEcho } = await import("@/lib/providerBills");
    await Promise.all(paperUnknown.map(async (r) => {
      const held = await refreshBillEcho(r.id, String(r.zoho_bill_id));
      if (held === null) return;
      r.zoho_echo = { ...(r.zoho_echo ?? {}), documents: held };
    }));
  }
  // Bills that are in the books but whose forms are not filed yet.
  type ComplianceRow = { id: string; institution: string; bill_no: string | null; bill_date: string | null;
    form145_part: string | null; form146_required: boolean; form145_filed_at: string | null; form146_filed_at: string | null };
  const { data: complianceData } = hubConnected
    ? await createServiceClient().from("provider_bills")
        .select("id, institution, bill_no, bill_date, form145_part, form146_required, form145_filed_at, form146_filed_at")
        .eq("status", "posted").not("form145_part", "is", null).is("form145_filed_at", null)
        .order("bill_date", { ascending: false }).limit(40)
    : { data: [] as never[] };
  const complianceRows = (complianceData ?? []) as unknown as ComplianceRow[];
  const { count: billsPosted } = hubConnected
    ? await createServiceClient().from("provider_bills").select("id", { count: "exact", head: true }).eq("status", "posted")
    : { count: 0 };
  const expenseChoices = zohoAccounts.filter((a) => a.type === "expense" || a.type === "other_expense" || a.type === "cost_of_goods_sold").map((a) => a.name);


  return (
    <DeskShell
      badge="🧾 Invoices & documents"
      title="Invoices"
      subtitle="Upload a supplier invoice, work out the entry — GST treatment, withholding, the rate and its source — and send it up for approval."
      current="/admin/zoho/invoices"
      message={sp.scan}
    >

  {/* HIS RULING: the vault is a repository only. Anything uploaded in
      order to be POSTED — a supplier invoice, any document that must
      become an entry — is uploaded here, and the provider-invoice API
      pull lives here with it. */}
      <form action={fetchProviderInvoicesAction} style={{ marginTop: 10 }}>
<SubmitButton className="btn small" savedLabel="✓ Pulled">🔄 Pull provider invoices by API (Bunny + Razorpay)</SubmitButton>
<span className="muted" style={{ fontSize: ".78rem", marginLeft: 10 }}>
  Bunny and Razorpay hand theirs over directly. Anthropic and Mailgun have no invoice API — theirs arrive by email.
</span>
      </form>

      <form action={addVaultDoc} className="card" style={{ marginTop: 10 }}>
<div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
  <div>
    <label>Document name</label>
    <input name="title" required placeholder="e.g. IBKR statement — July 2026" style={{ marginBottom: 0 }} />
  </div>
  <div>
    <label>Institution</label>
    <input name="institution" list="inst-names" placeholder="e.g. IBKR / Axis Bank / Income Tax / IRS" style={{ marginBottom: 0 }} />
    <datalist id="inst-names">
      {["Axis Bank", "SBI", "Kotak", "Bank of America", "DATCU", "IBKR", "Fidelity", "Robinhood", "ThinkorSwim", "Tasty Trade", "Citi", "Amex", "Income Tax (India)", "IRS (US)", "GST", "Razorpay", "Zoho"].map((n) => <option key={n} value={n} />)}
    </datalist>
  </div>
  <div>
    <label>Type</label>
    <select name="doc_type" style={{ marginBottom: 0 }}>
      {["Bank statement", "Credit-card statement", "Brokerage statement", "26AS", "AIS / TIS", "ITR / Return", "Tax computation", "US 1040", "GST challan / return", "TDS challan", "Invoice / bill", "Agreement", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  </div>
  <div>
    <label>Year</label>
    <input name="year_label" list="year-labels" placeholder="FY 2026-27 or CY 2026" style={{ marginBottom: 0 }} />
    <datalist id="year-labels">
      {["FY 2026-27", "FY 2025-26", "FY 2024-25", "CY 2026", "CY 2025", "CY 2024"].map((y) => <option key={y} value={y} />)}
    </datalist>
  </div>
  <div>
    <label>Raw or processed</label>
    <select name="is_processed" style={{ marginBottom: 0 }}>
      <option value="raw">Raw (as received)</option>
      <option value="processed">Processed (worked / annotated)</option>
    </select>
  </div>
  <div>
    <label>Description (optional)</label>
    <input name="note" placeholder="e.g. filed 28 Jul 2026" style={{ marginBottom: 0 }} />
  </div>
</div>
<PdfUpload name="file_url" folder="zoho-vault" label="The document (PDF)" />
<SubmitButton className="btn small" savedLabel="✓ Stored" style={{ marginTop: 8 }}>🗄️ Store in the vault</SubmitButton>
      </form>
  <p style={{ margin: "4px 0 8px" }}>
    <Link className="btn small secondary" href="/admin/zoho/activity">📜 What has changed in Zoho</Link>
    <span className="muted" style={{ fontSize: ".8rem", marginLeft: 8 }}>
      the last 50 changes to the books, by this desk or by anyone working in Zoho
    </span>
  </p>
  <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
    One line per invoice. Click it to see the entry proposed — the account, the GST, the TDS — change
    anything you disagree with <strong>here</strong>, and post it. What you change is remembered for that
    supplier. Nothing goes to Zoho until you press the green button.
  </p>

  <details className="card" style={{ marginBottom: 12 }}>
    <summary className="btn small secondary as-btn">✍️ Nothing to upload? Write the entry yourself</summary>
    <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0" }}>
      An invoice we are raising, a credit note, or a plain journal — the same questions as an invoice that
      arrives, asked the other way round.
    </p>
    <RaiseDocument action={raiseDocumentAction} accountList="acct-names" accounts={zohoAccounts} isFounder={isFounder} />
  </details>

  <form action={uploadBillAction} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
    <div style={{ minWidth: 190 }}>
      <label style={{ fontSize: ".75rem" }}>📤 Supplier</label>
      <input name="institution" list="inst-names" required placeholder="e.g. Vercel / HYTONE" style={{ marginBottom: 0 }} />
    </div>
    <div style={{ minWidth: 210 }}>
      <label style={{ fontSize: ".75rem" }}>The invoice (PDF)</label>
      <input type="file" name="file" required accept="application/pdf" style={{ marginBottom: 0 }} />
    </div>
    <input type="hidden" name="year_label" value={fyNow} />
    <SubmitButton className="btn small" savedLabel="✓ Read">📥 Add this invoice</SubmitButton>
  </form>

  {/* WHAT ZOHO ACTUALLY HOLDS. He said a 1% rate exists and the section
      wording may have changed — so the names are shown rather than
      guessed at, and the matcher accepts either the section or the
      rate. */}
  {/* ALWAYS SAY SOMETHING. This line rendered only when Zoho returned
      rates, so when the read came back empty the whole panel vanished
      and looked like "nothing to report" — which is the same mistake
      as treating a failed lookup as an absence. It now states what it
      found, including finding nothing. */}
  <p className="muted" style={{ fontSize: ".78rem", marginTop: 8, lineHeight: 1.7 }}>
    <strong>TDS rates in Zoho:</strong>{" "}
    {zohoTds.length
      ? `${zohoTds.map((t) => `${t.tax_name} (${t.tax_percentage}%)`).join(" · ")}. A bill matches on either the section wording or the rate, so a renamed section still finds its rate.`
      : `none came back${allTaxNames.length ? `, though Zoho does hold: ${allTaxNames.join(" · ")}` : ""}. Those are all GST rates, so TDS is either not switched on in Zoho (Settings → Taxes → Tax Settings → Enable TDS) or is not exposed on this endpoint. A bill still posts; its withholding is noted on the row for you to apply.`}
    <br />
    <strong>Sections our vendor rules withhold under:</strong>{" "}
    {tdsNeeded.length
      ? tdsNeeded.map((n) => `${n.section} @ ${n.rate}% (${n.vendors.join(", ")})`).join(" · ")
      : "none set."}
  </p>

  {tdsGaps.length > 0 && (
    <div className="card" style={{ marginTop: 8, borderLeft: "3px solid #b45309" }}>
      <strong>⚠️ Zoho has no TDS rate for {tdsGaps.length === 1 ? "one section" : `${tdsGaps.length} sections`} we withhold under</strong>
      <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px", lineHeight: 1.7 }}>
        A bill still posts, but the withholding does not attach to it — that is why FIRST FLY went in
        with its GST right and its ₹60 sitting outside the entry.
      </p>
      <p className="muted" style={{ fontSize: ".78rem", margin: "0 0 8px", lineHeight: 1.7 }}>
        Zoho&apos;s published API creates GST-type taxes only, so the button below <em>asks</em> and reports
        Zoho&apos;s own answer — it may well refuse. The reliable route is to switch TDS on in Zoho
        (<strong>Settings → Taxes → Tax Settings → Enable TDS</strong>) and add the rate there; once it
        exists, bills find it on their own, by the section wording <em>or</em> the rate.
      </p>
      {tdsGaps.map((g) => (
        <form action={createTdsTaxAction} key={`${g.section}|${g.rate}`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <input type="hidden" name="section" value={g.section} />
          <input type="hidden" name="rate" value={g.rate} />
          <span style={{ minWidth: 200, fontSize: ".85rem" }}><strong>{g.section}</strong> @ {g.rate}%</span>
          <span className="muted" style={{ fontSize: ".78rem", minWidth: 160 }}>{g.vendors.join(", ")}</span>
          <SubmitButton className="btn small secondary" savedLabel="✓ Asked">➕ Ask Zoho to create it</SubmitButton>
        </form>
      ))}
    </div>
  )}

  {billsWaiting.length === 0 && (
    <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing waiting.</p></div>
  )}

  {billsWaiting.map((b) => {
    const rule = ruleFor(b.institution);
    const foreign = (b.currency || "USD") !== "INR";
    const needAnswers = foreign && !(rule?.country && rule?.service_category);
    const d = b.determination;
    const p = b.proposal ?? {};
    const inr = Number(b.inr_amount ?? 0);
    // HIS ANSWER BEATS THE MACHINE'S GUESS.
    //
    // This read `d?.tdsRate ?? p.tds_rate` — the AI's determination
    // first, and `??` only falls through on null. So once the AI had
    // decided 10%, setting the rate to nil on the form changed the
    // stored proposal and the entry, and the headline went on saying
    // "TDS 10% = ₹234.88" for ever. He changed it, we saved it, and the
    // one line he reads kept quoting the figure he had just overruled.
    //
    // Zero is a real answer here, not an absent one, so the test is
    // whether he has SET the rate — not whether it is truthy.
    const setRate = p.tds_rate !== null && p.tds_rate !== undefined && String(p.tds_rate) !== "";
    const tdsRate = setRate ? Number(p.tds_rate) : (d?.tdsRate ?? null);
    // TDS IS ON THE VALUE, NOT THE TAX-INCLUSIVE TOTAL.
    //
    // This line worked the withholding out from `inr` — the whole
    // invoice — so on any bill where the supplier charged GST it showed
    // tax deducted on the tax as well. GST shown separately on an
    // invoice is outside the TDS base, which is his rule and is also
    // what the posting already does; the headline was the one place
    // still doing it the old way, and it is the line he reads first.
    //
    // The stored figure wins where there is one: it was computed by
    // tdsWorking at save time from the right base, so showing it means
    // the headline cannot disagree with what will actually post.
    const tdsBase = Number(b.taxable_value) > 0 ? Number(b.taxable_value) : inr;
    // A bill that has been worked out carries its own withholding, and
    // that is what will post — including when it is zero. Only a bill
    // nobody has saved yet falls back to computing from the rate.
    const worked = b.tds_amount !== null && b.tds_amount !== undefined;
    const tdsAmt = worked
      ? Number(b.tds_amount)
      : tdsRate ? Math.round(tdsBase * Number(tdsRate)) / 100 : 0;
    // A domestic bill whose invoice tax has not been keyed has no
    // taxable value to work from, so anything shown is on the gross.
    // Say so rather than print a figure that looks settled.
    const tdsOnGross = !!tdsRate && !(Number(b.taxable_value) > 0)
      && (p.gst_treatment === "domestic_itc" || p.gst_treatment === "itc");
    const waitingOnHim = pendingBillIds.has(b.id);

    // The one line. Everything he needs to decide whether to open it.
    const headline = needAnswers
      ? "needs two answers before it can be worked out"
      : !inr ? "amount could not be read — open and type it in"
      : `${p.gst_treatment === "rcm" ? "RCM 18%" : p.gst_treatment === "none" ? "no GST" : "GST 18% ITC"}` +
        `${tdsAmt > 0 ? ` · TDS ${tdsRate}% = ₹${tdsAmt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${tdsOnGross ? " (on the gross — key the invoice's taxable value)" : ""}` : " · no TDS"}` +
        ` → ${p.expense_account ?? "account not set"}`;

    return (
      <details className="card" key={b.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: `4px solid ${needAnswers || !inr ? "#b45309" : "#0e6e52"}` }}>
        {/* THE SUMMARY KEEPS ITS DEFAULT DISPLAY.
            Setting display:flex on a <summary> strips WebKit of the
            disclosure behaviour: on his Mac and his phone the line
            opened and then would not close again. The layout goes on a
            div inside it, where it costs nothing. */}
        <summary style={{ cursor: "pointer" }}>
          <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", width: "calc(100% - 1.4rem)" }}>
            <span style={{ minWidth: 92, fontSize: ".85rem" }}>{b.bill_date ?? "no date"}</span>
            <strong style={{ minWidth: 96 }}>{b.institution}</strong>
            <span className="muted" style={{ fontSize: ".82rem", minWidth: 130 }}>{b.bill_no ?? "no number"}</span>
            {/* An amount of zero here means the reader could not find one, not that the
                bill was for nothing — so it stays a dash. ₹0.00 in a money column
                is a figure, and it would be a false one. */}
            <span style={{ fontWeight: 600 }}><Money n={inr || null} /></span>
            <span className="muted" style={{ fontSize: ".82rem" }}>{headline}</span>
            {/* Say WHERE it is waiting. "sent to you by the desk" told
                him it had moved but not where to go, and while the gate
                was hiding bills that was the whole of the trail. */}
            {waitingOnHim && <span style={{ fontSize: ".75rem", color: "#b45309" }}>· waiting at your approval gate ↑</span>}
          </span>
        </summary>

        <div style={{ marginTop: 12 }}>
          {needAnswers ? (
            <form action={saveForeignAnswersAction}>
              <input type="hidden" name="institution" value={b.institution} />
              <input type="hidden" name="billing_frequency" value="monthly" />
              <p style={{ fontSize: ".85rem", margin: "0 0 8px" }}>
                {b.institution} is outside India. Two things decide the tax — asked once for this supplier.
              </p>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Which country are they in?</label>
                  <select name="country" required defaultValue={seedFor(b.institution)?.country ?? ""} style={{ marginBottom: 0 }}>
                    <option value="">— pick —</option>
                    {FVD.COUNTRIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: ".75rem" }}>What did they do for us?</label>
                  <select name="service_category" defaultValue={seedFor(b.institution)?.category ?? "standardised"} style={{ marginBottom: 0 }}>
                    <option value="standardised">Ready-made software / hosting we just use</option>
                    <option value="bespoke">Work done for us by their people</option>
                    <option value="advertising">Advertising</option>
                    <option value="mixed">Both</option>
                  </select>
                </div>
              </div>
              <SubmitButton className="btn small" savedLabel="✓" style={{ marginTop: 10 }}>Save and work out the entry</SubmitButton>
            </form>
          ) : (
            <form action={decideBillAction}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="vendor_name" value={p.vendor_name ?? b.institution} />

              {/* 1 — THE PAPER. Everything on it can be corrected here. */}
              <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".07em", color: "#666", margin: "0 0 6px" }}>
                1 · The invoice
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Supplier is</label>
                  <select name="supplier_kind" defaultValue={p.supplier_kind ?? (foreign ? "foreign" : "indian")} style={{ marginBottom: 0 }}>
                    <option value="indian">Indian</option>
                    <option value="foreign">Foreign</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Invoice number</label>
                  <input name="bill_no" defaultValue={b.bill_no ?? ""} style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Invoice date</label>
                  <input name="bill_date" type="date" defaultValue={b.bill_date ?? ""} style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Amount ({b.currency})</label>
                  <input name="amount" type="number" step="0.01" defaultValue={b.amount ?? ""} style={{ marginBottom: 0 }} />
                </div>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Exchange rate</label>
                  <input name="rate" type="number" step="0.0001" defaultValue={b.rate ?? ""} placeholder={foreign ? "₹ per unit" : "1"} style={{ marginBottom: 0 }} />
                  <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
                    {b.rate_date ? `SBI TT buy ${b.rate_date}, Rule 115` : "blank for an Indian invoice"}
                  </div>
                </div>
              </div>

              <EntryEditor
                inr={inr}
                who={p.vendor_name ?? b.institution}
                currency={b.currency}
                accountList="acct-names"
                accounts={zohoAccounts}
                foreign={foreign ? {
                  country: rule?.country ?? seedFor(b.institution)?.country ?? "United States",
                  category: rule?.service_category ?? seedFor(b.institution)?.category ?? "standardised",
                  countries: FVD.COUNTRIES.map((c) => c.name),
                } : null}
                taxRead={b.tax_read ?? null}
                initial={{
                  nature: p.nature ?? "expense",
                  operating: p.operating ?? "operating",
                  account: p.expense_account ?? "",
                  subAccount: p.sub_account ?? "",
                  gstTreatment: p.gst_treatment ?? (foreign ? "rcm" : "domestic_itc"),
                  gstRate: Number(p.gst_rate ?? 18),
                  tdsMode: p.tds_mode ?? (tdsRate ? "deduct" : "none"),
                  tdsRate: tdsRate === null || tdsRate === undefined ? "" : String(tdsRate),
                  tdsSection: p.tds_section ?? "",
                  // What the invoice printed, where somebody has keyed it.
                  taxable: b.taxable_value == null ? "" : String(b.taxable_value),
                  cgst: b.cgst_amount == null ? "" : String(b.cgst_amount),
                  sgst: b.sgst_amount == null ? "" : String(b.sgst_amount),
                  igst: b.igst_amount == null ? "" : String(b.igst_amount),
                }}
                compliance={d?.form145Part
                  ? `Form 145 Part ${d.form145Part}${d.form146Required ? " + Form 146 from your accountant" : ""}.` +
                    (d.warnings?.length ? ` ${d.warnings[0]}` : "")
                  : null}
              />

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
                <SubmitButton className="btn small" savedLabel="✓ Done">
                  📤 Send for approval
                </SubmitButton>
                <label style={{ fontWeight: 400, fontSize: ".8rem" }}>
                  <input type="checkbox" name="as_rule" value="yes" defaultChecked style={{ width: "auto", marginRight: 6 }} />
                  Remember all of this for {b.institution}
                </label>
              </div>
            </form>
          )}

          {/* READ THE TAX OFF THE PAPER. It proposes; it fills nothing
              in by itself, and Save stays his. */}
          <form action={readInvoiceTaxAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={b.id} />
            <SubmitButton className="btn small secondary" savedLabel="✓ Read">📄 Read the tax off the invoice</SubmitButton>
            <span className="muted" style={{ fontSize: ".76rem", marginLeft: 8 }}>
              Transcribes the taxable value and CGST/SGST/IGST from the filed PDF and shows them above for you to check. Nothing is derived.
            </span>
          </form>

          <form action={removeBillAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={b.id} />
            <SubmitButton className="btn small secondary" savedLabel="Removed">🗑 Remove from this list</SubmitButton>
            <span className="muted" style={{ fontSize: ".76rem", marginLeft: 8 }}>The PDF stays in the vault.</span>
          </form>
        </div>
      </details>
    );
  })}

  {billsPostedRows.length > 0 && (
    <details className="card" style={{ marginTop: 10 }}>
      <summary className="btn small secondary as-btn">📗 In the books ({billsPostedRows.length}) — with their paper</summary>
      <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0" }}>
        What Zoho holds, and whether the supplier&apos;s own invoice is attached to it there. An entry and the
        document behind it should never be two separate hunts.
      </p>
      {billsPostedRows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", padding: "5px 0", borderTop: "1px solid rgba(0,0,0,.06)", fontSize: ".83rem" }}>
          <span style={{ minWidth: 88 }}>{r.bill_date}</span>
          <strong style={{ minWidth: 96 }}>{r.institution}</strong>
          <span className="muted" style={{ minWidth: 120 }}>{r.bill_no ?? "—"}</span>
          {r.zoho_echo && (
            <span className="muted">
              {r.zoho_echo.currency} {r.zoho_echo.total}
              {r.zoho_echo.exchange_rate && r.zoho_echo.currency !== "INR" ? ` @ ₹${r.zoho_echo.exchange_rate}` : ""}
              {r.zoho_echo.reverse_charge ? " · RCM" : ""}
              {r.zoho_echo.zoho_status ? ` · ${r.zoho_echo.zoho_status}` : ""}
            </span>
          )}
          {r.error && <span style={{ color: "#b45309" }}>⚠ {r.error}</span>}
          <span style={{ marginLeft: "auto" }}>
            {!r.zoho_bill_id ? null
              : Number(r.zoho_echo?.documents ?? 0) > 0
                ? <span style={{ color: "#0e6e52", fontSize: ".78rem" }} title="Zoho holds the supplier's own invoice against this bill">📎 invoice attached</span>
              : !r.vault_doc_id ? null
              : r.paper_note
                ? <span style={{ color: "#b45309", fontSize: ".78rem" }}>📎 {r.paper_note}</span>
                : (
                  <form action={attachPaperAction} style={{ margin: 0 }}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="btn small secondary" savedLabel="📎 attached">📎 Attach the invoice</SubmitButton>
                  </form>
                )}
          </span>
        </div>
      ))}
    </details>
  )}

  {raised.length > 0 && (
    <details className="card" style={{ marginTop: 10 }}>
      <summary className="btn small secondary as-btn">📗 Raised by us ({raised.length})</summary>
      <div style={{ marginTop: 8 }}>
        {raised.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", padding: "6px 0", borderTop: "1px solid rgba(0,0,0,.06)", fontSize: ".84rem" }}>
            <span style={{ minWidth: 88 }}>{r.doc_date}</span>
            <span style={{ minWidth: 92 }}>
              {r.kind === "credit_note" ? "Credit note" : r.kind === "journal" ? "Journal" : "Invoice"}
            </span>
            <strong style={{ minWidth: 130 }}>{r.party_name ?? r.description ?? "—"}</strong>
            <span style={{ fontWeight: 600 }}><Money n={r.inr_amount === null ? null : Number(r.inr_amount)} width={98} /></span>
            <span className="muted">{r.ledger ?? ""}{Number(r.tds_rate) > 0 ? ` · TDS ${r.tds_rate}% withheld by them` : ""}</span>
            <span style={{ marginLeft: "auto" }}>
              {r.status === "posted"
                ? <span style={{ color: "#0e6e52" }}>✅ {r.zoho_number ?? "posted"}</span>
                : r.status === "failed"
                  ? <span style={{ color: "#b91c1c" }}>❌ {r.error}</span>
                  : <span className="muted">waiting</span>}
            </span>
            {r.status === "failed" && (
              <form action={retryDocumentAction} style={{ margin: 0 }}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton className="btn small secondary" savedLabel="↻">Try again</SubmitButton>
              </form>
            )}
          </div>
        ))}
      </div>
    </details>
  )}

  {complianceRows.length > 0 && (
    <details className="card" style={{ marginTop: 10 }}>
      <summary className="btn small secondary as-btn">📋 Forms still to file ({complianceRows.length})</summary>
      <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0" }}>
        A remittance is not finished when the bill is booked — each of these still carries its Form 145.
      </p>
      {complianceRows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "4px 0", fontSize: ".82rem" }}>
          <span style={{ minWidth: 200 }}>{r.bill_date} · <strong>{r.institution}</strong> {r.bill_no ?? ""}</span>
          <span>Part {r.form145_part}{r.form146_required ? " + Form 146" : ""}</span>
          {!r.form145_filed_at && (
            <form action={markFormFiledAction} style={{ margin: 0 }}>
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="which" value="145" />
              <SubmitButton className="btn small secondary" savedLabel="✓">Filed</SubmitButton>
            </form>
          )}
        </div>
      ))}
    </details>
  )}
    </DeskShell>
  );
}
