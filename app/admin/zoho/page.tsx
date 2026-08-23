import AdminHero from "../_components/AdminHero";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";
import { getSecret } from "@/lib/secrets";
import { zohoConfigured } from "@/lib/zohoApi";
import { FVD, KNOWN_FOREIGN_VENDORS } from "@/lib/foreignVendorDesk";
import SubmitButton from "@/app/components/SubmitButton";
import PdfUpload from "../_components/PdfUpload";
import DeleteButton from "../_components/DeleteButton";
import { addVaultDoc, deleteVaultDoc, connectZoho, scanSalesAction, approvePostingAction, approveAllDraftsAction, skipPostingAction, retryPostingAction, scanSettlementsAction, approveSettlementAction, approveAllSettlementsAction, skipSettlementAction, retrySettlementAction, approveSelectedSettlementsAction, skipSelectedSettlementsAction, approveSelectedLinesAction, skipSelectedLinesAction, approveSelectedBrokerageAction, skipSelectedBrokerageAction, scanBillsAction, readbackBillsAction, recheckBillDatesAction, saveBillRuleAction, saveForeignAnswersAction, markFormFiledAction, uploadBillAction, approveSelectedBillsAction, skipSelectedBillsAction, uploadStatementAction, answerLineAction, approveAutoLineAction, approveAllAutoAction, skipLineAction, retryLineAction, addPettyPersonAction, recordAdvanceAction, approveBillAction, rejectBillAction, retryBillAction, uploadBrokerageAction, postBrokerageLineAction, approveAllBrokerageAction, skipBrokerageLineAction, retryBrokerageLineAction, saveTaxAssumptionsAction, fetchProviderInvoicesAction } from "./actions";
import { listZohoAccounts } from "@/lib/bankStatements";
import { pettyBalances } from "@/lib/pettyCash";
import SettlementPicker from "./SettlementPicker";
import QueuePicker from "./QueuePicker";
import { rule115Rate, ttBuyRate } from "@/lib/forexRates";
import { fySnapshot, indiaAdvanceTax, usEstimatedTax, taxAssumptions } from "@/lib/taxEngine";
import { backlogItems, searchDesk } from "@/lib/zohoDesk";
import type { SalePayload } from "@/lib/zohoPosting";
import { formatINR } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zoho accounting hub — Admin" };

// THE BOOKS DESK (phase 1 skeleton, started 22 Aug 2026).
//
// The founder's rule: he and the accounts team work ONLY here; Zoho Books is a
// ledger this system writes to, never a place anyone types in. The full design
// — posting rulebook, three queues (auto / confirm / ask-me), statement
// ingestion with continuity checks, petty-cash imprest, rent roll, Rule-115
// rates, dual India/US tax engines — was agreed with the founder on 22 Aug.
// Cutover: 1 APRIL 2026 (founder, 22 Aug — books locked before that date, so
// the system owns the whole FY 2026-27; Apr-Aug backfills via the recon queues
// with match-don't-duplicate). Everything runs as drafts until approved.
//
// Access: the "zoho" grant (founder-given; Pradeep at launch). The document
// vault below renders for role=admin ALONE — the area grant does not reach it.

const PHASE_PLAN: { name: string; what: string; state: "done" | "building" | "waiting" | "planned" }[] = [
  { name: "Hub & document vault", what: "This page, the access grant, and the indexed document vault (year → institution → files; whole desk reads, founder deletes).", state: "done" },
  { name: "Zoho connection", what: "The portal's own Self-Client key — connected to ALDINECA.", state: "done" },
  { name: "Rulebook", what: "Learned from the office's own FY26-27 entries and locked: same series, same accounts, same style — automatically.", state: "done" },
  { name: "Sales posting", what: "Every paid portal sale becomes a draft in the queue below; approving posts the CAPS invoice + payment to Zoho.", state: "done" },
  { name: "Razorpay settlements", what: "Fetched from Razorpay, one journal each: net to Axis, fee+GST to Payment Gateway Charges (AI), gross out of clearing — queue below.", state: "done" },
  { name: "Bank statements", what: "Upload per account (CSV/Excel/PDF) → matched / rule-proposed / ask-once queues, continuity checks — section below.", state: "done" },
  { name: "Petty cash (advances)", what: "Record advances, per-person balances, bill uploads on /admin/petty, approve → posts to Zoho — section below.", state: "done" },
  { name: "Rule-115 rates", what: "SBI TT buying rates auto-fetched from officialforexrates.com (the founder's sole authority), stored with provenance, holiday walk-back — card below.", state: "done" },
  { name: "Rent roll & GST/TDS", what: "Co-owned commercial rent (two invoices, TDS per PAN), residential rent.", state: "planned" },
  { name: "Brokerage engine", what: "US brokerage statements → Rule-115-converted queue: dividends/interest/fees/buys pre-proposed, sells ask their cost — section below. (Cards run through Bank statements.)", state: "done" },
  { name: "Tax worksheets", what: "India advance-tax ladder from the live books + US 1040-ES safe-harbour calendar — founder-only section below. CPA packs & reconciliation reports follow.", state: "done" },
];

const STATE_BADGE: Record<string, { text: string; colour: string }> = {
  done: { text: "✅ live", colour: "#16a34a" },
  building: { text: "🔨 being built", colour: "#b45309" },
  waiting: { text: "⏳ needs the founder", colour: "#2563eb" },
  planned: { text: "🗓️ planned", colour: "var(--muted)" },
};

type PostingRow = {
  id: string; source_table: string; order_no: number | null; status: string;
  payload: SalePayload; zoho_invoice_number: string | null; error: string | null; posted_at: string | null;
};

export default async function ZohoHubPage(props: {
  searchParams: Promise<{ zoho_ok?: string; zoho_err?: string; scan?: string; upto?: string; q?: string; from?: string; to?: string; part?: string }>;
}) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const upto = sp.upto && /^\d{4}-\d{2}-\d{2}$/.test(sp.upto) ? sp.upto : todayIST;
  const searching = Boolean((sp.q ?? "").trim() || sp.from || sp.to || (sp.part && sp.part !== "all"));
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";

  const hubConnected = await zohoConfigured();
  const connected = isFounder ? hubConnected : false;
  const orgId = connected ? await getSecret("ZOHO_ORG_ID") : "";

  // The sales → Zoho queue (whole zoho area works this, not just the founder).
  const { data: postingRows } = hubConnected
    ? await createServiceClient().from("zoho_postings")
        .select("id, source_table, order_no, status, payload, zoho_invoice_number, error, posted_at")
        .order("order_no", { ascending: true })
    : { data: [] as PostingRow[] };
  const postings = (postingRows ?? []) as PostingRow[];
  const byStatus = (s: string) => postings.filter((p) => p.status === s);
  const drafts = byStatus("draft");
  const needsInfo = byStatus("needs_info");
  const failed = byStatus("failed");
  const posted = byStatus("posted");
  const matchedRows = byStatus("matched");

  type SettleRow = {
    id: string; settlement_id: string; utr: string | null; settled_on: string;
    net_inr: number; fees_inr: number; tax_inr: number; gross_inr: number;
    status: string; error: string | null;
  };
  const { data: settleData } = hubConnected
    ? await createServiceClient().from("zoho_settlements")
        .select("id, settlement_id, utr, settled_on, net_inr, fees_inr, tax_inr, gross_inr, status, error")
        .order("settled_on", { ascending: false })
    : { data: [] as SettleRow[] };
  const settles = (settleData ?? []) as SettleRow[];
  const sBy = (s: string) => settles.filter((x) => x.status === s);
  const sDrafts = sBy("draft"); const sFailed = sBy("failed");
  const sPosted = sBy("posted"); const sMatched = sBy("matched");

  // Bank statements + the three queues.
  type StmtRow = { id: string; account_name: string; file_name: string | null; period_start: string | null; period_end: string | null; opening_balance: number | null; closing_balance: number | null; continuity_ok: boolean | null; note: string | null; status: string; lines_total: number };
  type LineRow = { id: string; account_name: string; line_date: string; narration: string; ref: string | null; debit: number; credit: number; status: string; proposal: { account?: string } | null; matched_note: string | null; error: string | null };
  const [{ data: stmtData }, { data: lineData }] = hubConnected
    ? await Promise.all([
        createServiceClient().from("bank_statements").select("id, account_name, file_name, period_start, period_end, opening_balance, closing_balance, continuity_ok, note, status, lines_total").order("created_at", { ascending: false }).limit(20),
        createServiceClient().from("bank_lines").select("id, account_name, line_date, narration, ref, debit, credit, status, proposal, matched_note, error").in("status", ["ask", "auto", "failed"]).order("line_date").limit(200),
      ])
    : [{ data: [] as StmtRow[] }, { data: [] as LineRow[] }];
  const stmts = (stmtData ?? []) as StmtRow[];
  const bankLines = (lineData ?? []) as LineRow[];
  const askLines = bankLines.filter((l) => l.status === "ask");
  const autoLines = bankLines.filter((l) => l.status === "auto");
  const failedLines = bankLines.filter((l) => l.status === "failed");
  const { count: postedLineCount } = hubConnected
    ? await createServiceClient().from("bank_lines").select("id", { count: "exact", head: true }).in("status", ["posted", "matched"])
    : { count: 0 };

  // Account choices: bank/credit-card accounts for the upload picker; every
  // active account name for the ask-form datalist. Cached 10 min in the lib.
  let zohoAccounts: { name: string; type: string }[] = [];
  if (hubConnected) { try { zohoAccounts = await listZohoAccounts(); } catch { /* section degrades gracefully */ } }
  const bankChoices = zohoAccounts.filter((a) => a.type === "bank" || a.type === "credit_card").map((a) => a.name);
  const allAccountNames = zohoAccounts.map((a) => a.name);
  // A sensible rule-pattern suggestion: the narration's most merchant-ish token.
  const suggestPattern = (narration: string) => {
    const cleaned = narration.replace(/^(UPI|INB|NEFT|IMPS|RTGS|POS|ATM)[\/ -]*/i, "").replace(/^(P2M|P2A|IFT|NEFT|IMPS)[\/ -]*/i, "");
    const seg = cleaned.split("/").map((s) => s.trim()).filter((s) => s.length >= 4 && !/^\d+$/.test(s));
    return (seg[0] ?? cleaned).slice(0, 40);
  };

  // Petty cash: balances + pending bills + failed advances.
  type BillRow = { id: string; bill_date: string; amount: number; purpose: string; status: string; file_url: string | null; error: string | null; person: { name: string } | null };
  const pBalances = hubConnected ? await pettyBalances().catch(() => []) : [];
  const { data: pendingBillData } = hubConnected
    ? await createServiceClient().from("petty_bills")
        .select("id, bill_date, amount, purpose, status, file_url, error, person:person_id(name)")
        .in("status", ["pending", "failed"]).order("created_at")
    : { data: [] as never[] };
  const pendingBills = (pendingBillData ?? []) as unknown as BillRow[];
  const { data: failedAdvData } = hubConnected
    ? await createServiceClient().from("petty_advances")
        .select("id, adv_date, amount, error, person:person_id(name)").eq("status", "failed")
    : { data: [] as never[] };
  const failedAdvs = (failedAdvData ?? []) as unknown as { id: string; adv_date: string; amount: number; error: string | null; person: { name: string } | null }[];
  const advanceAccountChoices = zohoAccounts.filter((a) => a.type === "other_current_asset").map((a) => a.name);

  // Rule 115: the USD rate applicable to income arising THIS month (= SBI TT
  // buy on the last day of the previous month), auto-fetched from the founder's
  // designated source and stored with provenance.
  let r115: { rate: number; rateDate: string; keyDate: string } | null = null;
  if (hubConnected) {
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      r115 = await rule115Rate(today, "USD");
    } catch { /* card simply hides on a source hiccup */ }
  }

  // Brokerage queue.
  type BrokRow = { id: string; account_name: string; line_date: string; kind: string; symbol: string | null; usd_amount: number; rate: number | null; rate_date: string | null; inr_amount: number | null; description: string | null; status: string; proposal: { account?: string } | null; error: string | null };
  const { data: brokData } = hubConnected
    ? await createServiceClient().from("brokerage_lines")
        .select("id, account_name, line_date, kind, symbol, usd_amount, rate, rate_date, inr_amount, description, status, proposal, error")
        .in("status", ["ask", "auto", "failed"]).order("line_date").limit(200)
    : { data: [] as never[] };
  const brokLines = (brokData ?? []) as unknown as BrokRow[];
  const bAsk = brokLines.filter((l) => l.status === "ask");
  const bAuto = brokLines.filter((l) => l.status === "auto");
  const bFailed = brokLines.filter((l) => l.status === "failed");
  const { count: bDone } = hubConnected
    ? await createServiceClient().from("brokerage_lines").select("id", { count: "exact", head: true }).eq("status", "posted")
    : { count: 0 };
  // Brokerages + retirement funds + managed/investment accounts — and a free
  // "anything else" choice below, so no account type is ever locked out.
  const brokerageChoices = zohoAccounts.filter((a) =>
    (a.type === "bank" && /brokerage|thinkorswim|tasty/i.test(a.name)) ||
    ((a.type === "other_current_asset" || a.type === "other_asset") && /\bIRA\b|401|retirement|managed|invest|treasury direct/i.test(a.name)),
  ).map((a) => a.name);

  // Rule 115 panel: last 5 month-end USD rates (DB-first; auto-fetch fills gaps).
  const monthEnds: { keyDate: string; rate: number | null; rateDate: string | null }[] = [];
  if (hubConnected) {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 0));
      const key = d.toISOString().slice(0, 10);
      try {
        const r = await ttBuyRate(key, "USD");
        monthEnds.push({ keyDate: key, rate: r?.rate ?? null, rateDate: r?.rateDate ?? null });
      } catch { monthEnds.push({ keyDate: key, rate: null, rateDate: null }); }
    }
  }

  // Tax worksheets (founder-only).
  let taxData: { snap: Awaited<ReturnType<typeof fySnapshot>>; india: ReturnType<typeof indiaAdvanceTax>; us: ReturnType<typeof usEstimatedTax>; assume: Awaited<ReturnType<typeof taxAssumptions>> } | null = null;
  if (isFounder && hubConnected) {
    try {
      const assume = await taxAssumptions();
      const snap = await fySnapshot();
      taxData = { snap, india: indiaAdvanceTax(snap, assume.effRatePct), us: usEstimatedTax(assume.usPriorYearTaxUsd), assume };
    } catch { /* worksheet hides on a hiccup */ }
  }

  type VaultDoc = { id: string; title: string; note: string | null; institution: string | null; doc_type: string | null; year_label: string | null; is_processed: boolean; created_at: string };
  // Backlog + desk-wide search.
  let backlog: Awaited<ReturnType<typeof backlogItems>> = { items: [], neverUploaded: [] };
  if (hubConnected) { try { backlog = await backlogItems(upto); } catch { /* section degrades */ } }
  let searchRows: Awaited<ReturnType<typeof searchDesk>> = [];
  if (hubConnected && searching) {
    try { searchRows = await searchDesk({ q: sp.q, from: sp.from, to: sp.to, part: sp.part }); } catch { /* empty */ }
  }

  // Provider invoices waiting to become Zoho BILLS.
  type ProviderBillRow = { id: string; institution: string; bill_no: string | null; bill_date: string | null; currency: string; amount: number | null; inr_amount: number | null; rate: number | null; status: string; proposal: { vendor_name?: string; expense_account?: string; gst_treatment?: string; gst_rate?: number; tds_section?: string | null; tds_rate?: number | null } | null; error: string | null;
    determination: { tdsLabel?: string; confidence?: string; form145Part?: string | null; form146Required?: boolean; warnings?: string[]; certAdvice?: { why: string; points: string[] } | null; grossedUp?: number | null } | null };
  const { data: billData } = hubConnected
    ? await createServiceClient().from("provider_bills")
        .select("id, institution, bill_no, bill_date, currency, amount, inr_amount, rate, status, proposal, error, determination")
        .in("status", ["needs_info", "draft", "failed"]).order("bill_date")
    : { data: [] as never[] };
  const bills = (billData ?? []) as unknown as ProviderBillRow[];
  const billsDraft = bills.filter((b) => b.status === "draft");
  const billsAsk = bills.filter((b) => b.status === "needs_info");
  const billsFailed = bills.filter((b) => b.status === "failed");
  // One card per vendor still without a ruling.
  const askVendors = [...new Set(billsAsk.map((b) => b.institution))];
  // A foreign vendor whose withholding questions have never been answered. The
  // treatment card cannot help here — without the country and what they did,
  // there is no way to know what to withhold.
  const { data: ruleRows } = hubConnected
    ? await createServiceClient().from("provider_bill_rules").select("*")
    : { data: [] as never[] };
  const answered = new Set((ruleRows ?? [])
    .filter((r) => r.country && r.service_category && r.billing_frequency)
    .map((r) => String(r.institution)));
  const foreignAsk = [...new Set(bills
    .filter((b) => (b.currency || "USD") !== "INR" && !answered.has(b.institution))
    .map((b) => b.institution))];
  // Answers already on file. They are not frozen — a residency certificate
  // arrives, a s.395 certificate is granted, a vendor starts doing bespoke work
  // — and changing them re-works every invoice of theirs still waiting.
  type ForeignRule = { institution: string; country: string | null; service_category: string | null;
    billing_frequency: string | null; has_trc: boolean; has_form10f: boolean; has_no_pe: boolean;
    has_395_cert: boolean; expected_annual: number | null };
  const foreignOnFile = ((ruleRows ?? []) as unknown as ForeignRule[])
    .filter((r) => r.country && r.service_category)
    .sort((a, b) => a.institution.localeCompare(b.institution));
  type PostedBillRow = {
    id: string; institution: string; bill_no: string | null; bill_date: string | null; error: string | null;
    zoho_echo: { currency?: string | null; total?: number | null; exchange_rate?: number | null;
      tax_total?: number | null; reverse_charge?: boolean | null; zoho_status?: string | null } | null;
  };
  const { data: billsPostedData } = hubConnected
    ? await createServiceClient().from("provider_bills")
        .select("id, institution, bill_no, bill_date, zoho_echo, error")
        .eq("status", "posted").order("bill_date", { ascending: false }).limit(50)
    : { data: [] as never[] };
  const billsPostedRows = (billsPostedData ?? []) as unknown as PostedBillRow[];
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

  const { data: docsData } = await createServiceClient()
    .from("zoho_vault_docs")
    .select("id, title, note, institution, doc_type, year_label, is_processed, created_at")
    .order("year_label", { ascending: false }).order("institution").order("created_at", { ascending: false });
  const docs = (docsData ?? []) as VaultDoc[];
  // Grouped index: year → institution → files.
  const docGroups = new Map<string, Map<string, VaultDoc[]>>();
  for (const d of docs) {
    const y = d.year_label || "Unfiled";
    const inst = d.institution || "General";
    if (!docGroups.has(y)) docGroups.set(y, new Map());
    const g = docGroups.get(y)!;
    g.set(inst, [...(g.get(inst) ?? []), d]);
  }

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 980 }}>
      <AdminHero
        badge="🧮 Zoho — accounting hub"
        title="The books desk"
        subtitle="Everything is entered HERE and pushed to Zoho Books — statements, sales, advances, rent. Nobody types in Zoho. The system owns FY 2026-27 from 1 April 2026 (books locked before that); April–August is backfilled with a strict match-don't-duplicate rule, and everything runs as drafts until approved."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* The standing rule, said where the person who will live on this page reads it. */}
      <div className="notice" style={{ marginTop: 14, fontSize: ".85rem", lineHeight: 1.7 }}>
        <strong>The one rule of this desk:</strong> Zoho is written to, never worked in. Every entry starts here,
        gets approved here, and is pushed with its portal reference — so nothing ever posts twice, and a correction
        is a fresh entry, never a silent edit. Bank feeds inside Zoho stay <strong>disconnected</strong>.
      </div>

      {/* ── Pradeep's backlog — as-of a chosen date ─────────────────── */}
      {hubConnected && (
        <div id="backlog" className="card" style={{ marginTop: 16 }}>
          <form style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong>📋 Task list — what is pending till</strong>
            <input type="date" name="upto" defaultValue={upto} style={{ marginBottom: 0 }} />
            <SubmitButton className="btn small secondary" savedLabel="✓">Show backlog</SubmitButton>
            <span className="muted" style={{ fontSize: ".78rem" }}>Change the date and the backlog recomputes.</span>
          </form>
          {backlog.items.length === 0 ? (
            <p className="muted" style={{ margin: "10px 0 0", fontSize: ".88rem" }}>✅ Nothing pending up to {upto} — statements covered and every queue clear.</p>
          ) : (
            <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
              {backlog.items.map((b, i) => (
                <a key={i} href={b.anchor} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 10px", background: "var(--bg-soft)", borderRadius: 8, color: "var(--text)", textDecoration: "none" }}>
                  <span className="badge" style={{ fontSize: ".7rem", minWidth: 110, textAlign: "center" }}>{b.part}</span>
                  <span style={{ flex: 1, fontSize: ".86rem" }}>{b.task}</span>
                  {b.count !== undefined && <strong>{b.count}</strong>}
                  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".8rem" }}>open →</span>
                </a>
              ))}
            </div>
          )}
          {backlog.neverUploaded.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: ".8rem" }}>
                {backlog.neverUploaded.length} account(s) with no statement uploaded yet
              </summary>
              <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0" }}>{backlog.neverUploaded.join(" · ")}</p>
            </details>
          )}
        </div>
      )}

      {/* ── Desk-wide search & filter (the reconciliation view) ─────── */}
      {hubConnected && (
        <div id="search" className="card" style={{ marginTop: 12 }}>
          <form style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: ".72rem" }}>🔎 Search everything</label>
              <input name="q" defaultValue={sp.q ?? ""} placeholder="narration, customer, UTR, symbol, order no…" style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={{ fontSize: ".72rem" }}>From</label>
              <input type="date" name="from" defaultValue={sp.from ?? ""} style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={{ fontSize: ".72rem" }}>To</label>
              <input type="date" name="to" defaultValue={sp.to ?? ""} style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={{ fontSize: ".72rem" }}>Part</label>
              <select name="part" defaultValue={sp.part ?? "all"} style={{ marginBottom: 0 }}>
                <option value="all">Everything</option>
                <option value="sales">Sales</option>
                <option value="settlements">Settlements</option>
                <option value="bank">Bank lines</option>
                <option value="brokerage">Brokerage</option>
                <option value="petty">Petty cash</option>
              </select>
            </div>
            <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
            {searching && <a className="btn small secondary" href="/admin/zoho#search">Clear</a>}
          </form>
          {searching && (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ fontSize: ".8rem", margin: "0 0 6px" }}>{searchRows.length} result(s){searchRows.length === 300 ? " (first 300)" : ""} — every status included, for reconciliation.</p>
              <div style={{ display: "grid", gap: 4 }}>
                {searchRows.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "5px 10px", background: "var(--bg-soft)", borderRadius: 6, fontSize: ".82rem" }}>
                    <span style={{ whiteSpace: "nowrap" }}>{r.date}</span>
                    <span className="badge" style={{ fontSize: ".68rem" }}>{r.part}</span>
                    <span style={{ flex: 1, minWidth: 200 }}>{r.label}</span>
                    {r.amount !== null && <strong style={{ whiteSpace: "nowrap" }}>{r.amount < 0 ? `− ${formatINR(Math.abs(r.amount))}` : formatINR(r.amount)}</strong>}
                    <span className="muted" style={{ fontSize: ".74rem" }}>{r.status}{r.ref ? ` · ${r.ref}` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Sales → Zoho queue (the working desk) ───────────────────── */}
      {hubConnected && (
        <div id="queue">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 24 }}>
            <h2 className="admin-section-title" style={{ margin: 0 }}>📮 Sales → Zoho</h2>
            <form action={scanSalesAction} style={{ margin: 0 }}>
              <SubmitButton className="btn small secondary" savedLabel="Scanned">🔄 Scan for new sales</SubmitButton>
            </form>
            {drafts.length > 0 && (
              <form action={approveAllDraftsAction} style={{ margin: 0 }}>
                <SubmitButton className="btn small" savedLabel="✓ Posted">✅ Approve &amp; post all {drafts.length} draft(s)</SubmitButton>
              </form>
            )}
            <span className="muted" style={{ fontSize: ".8rem" }}>
              ✅ posted {posted.length} · 🤝 matched to manual entries {matchedRows.length}
            </span>
          </div>
          {sp.scan && <div className="notice ok" style={{ marginTop: 10 }}>🔄 {sp.scan}</div>}
          <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
            Each paid portal sale becomes a draft here. Approving posts it to Zoho exactly as the office does by
            hand: the portal&apos;s own CAPS invoice number, booked to Sales-Classes (Sales-Validity for extensions),
            SAC 999293, and the payment into Razorpay Clearing with the E-series receipt. Anything the office has
            already entered manually is recognised by its order number and left alone.
          </p>

          {drafts.length === 0 && needsInfo.length === 0 && failed.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing waiting — every sale is posted or matched. 🔄 Scan picks up new ones.</p></div>
          )}

          {[...failed, ...needsInfo, ...drafts].map((r) => (
            <div className="card" key={r.id} style={{ marginTop: 8, borderLeft: `4px solid ${r.status === "failed" ? "#b91c1c" : r.status === "needs_info" ? "#b45309" : "var(--accent)"}` }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <strong>#{r.order_no}</strong>
                <span style={{ flex: 1, minWidth: 220, fontSize: ".88rem" }}>
                  {r.payload.customer} · {formatINR(r.payload.amountInr)} · {r.payload.date}
                  <span className="muted"> · {r.payload.description}</span>
                  {r.payload.invoiceNo && <span className="muted"> · {r.payload.invoiceNo}</span>}
                </span>
                {r.status === "draft" && (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <form action={approvePostingAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn small" savedLabel="✓ Posted">✅ Approve &amp; post</SubmitButton>
                    </form>
                    <form action={skipPostingAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Skip</SubmitButton>
                    </form>
                  </span>
                )}
                {r.status === "needs_info" && (
                  <span style={{ fontSize: ".8rem", color: "#b45309", fontWeight: 700 }}>
                    ⏳ waiting: {!r.payload.invoiceNo ? "portal invoice not generated yet" : "customer state missing"} — 🔄 Scan refreshes it
                  </span>
                )}
                {r.status === "failed" && (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: ".78rem", color: "#b91c1c" }}>{r.error}</span>
                    <form action={retryPostingAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">↻ Retry</SubmitButton>
                    </form>
                  </span>
                )}
              </div>
            </div>
          ))}

          {(posted.length > 0 || matchedRows.length > 0) && (
            <details style={{ marginTop: 10 }}>
              <summary className="btn small secondary as-btn">📗 Done ({posted.length + matchedRows.length})</summary>
              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {[...posted, ...matchedRows].sort((a, b) => (b.order_no ?? 0) - (a.order_no ?? 0)).map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 10, fontSize: ".82rem", padding: "4px 10px", background: "var(--bg-soft)", borderRadius: 6, flexWrap: "wrap" }}>
                    <span>{r.status === "posted" ? "✅" : "🤝"} #{r.order_no}</span>
                    <span style={{ flex: 1, minWidth: 160 }}>{r.payload.customer} · {formatINR(r.payload.amountInr)}</span>
                    <span className="muted">{r.zoho_invoice_number ?? r.payload.invoiceNo}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Razorpay settlements → Zoho ─────────────────────────────── */}
      {hubConnected && (
        <div id="settlements">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 26 }}>
            <h2 className="admin-section-title" style={{ margin: 0 }}>🏦 Razorpay settlements → Zoho</h2>
            <form action={scanSettlementsAction} style={{ margin: 0 }}>
              <SubmitButton className="btn small secondary" savedLabel="Scanned">🔄 Fetch settlements</SubmitButton>
            </form>
            {sDrafts.length > 0 && (
              <form action={approveAllSettlementsAction} style={{ margin: 0 }}>
                <SubmitButton className="btn small" savedLabel="✓ Posted">✅ Approve &amp; post all {sDrafts.length}</SubmitButton>
              </form>
            )}
            <span className="muted" style={{ fontSize: ".8rem" }}>✅ posted {sPosted.length} · 🤝 matched {sMatched.length}</span>
          </div>
          <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
            Fetched straight from Razorpay (from 1 April 2026). Each settlement posts one journal — net to Axis
            Current, fee + GST to Payment Gateway Charges (AI), gross out of Razorpay Clearing — reference = the bank
            UTR. A settlement the office already booked (same UTR on a journal) is recognised and left alone.
            Approve against the Razorpay dashboard figures the first few times.
          </p>

          {sDrafts.length === 0 && sFailed.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>No settlements waiting. 🔄 Fetch pulls the latest from Razorpay.</p></div>
          ) : (
            <SettlementPicker
              rows={[...sFailed, ...sDrafts].map((r) => ({
                id: r.id, settled_on: r.settled_on, net: Number(r.net_inr),
                fees: Number(r.fees_inr) + Number(r.tax_inr), gross: Number(r.gross_inr),
                utr: r.utr, settlement_id: r.settlement_id, status: r.status, error: r.error,
              }))}
              approveSelected={approveSelectedSettlementsAction}
              skipSelected={skipSelectedSettlementsAction}
            />
          )}

          {(sPosted.length > 0 || sMatched.length > 0) && (
            <details style={{ marginTop: 10 }}>
              <summary className="btn small secondary as-btn">📗 Done ({sPosted.length + sMatched.length})</summary>
              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {[...sPosted, ...sMatched].map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 10, fontSize: ".82rem", padding: "4px 10px", background: "var(--bg-soft)", borderRadius: 6, flexWrap: "wrap" }}>
                    <span>{r.status === "posted" ? "✅" : "🤝"} {r.settled_on}</span>
                    <span style={{ flex: 1, minWidth: 160 }}>net {formatINR(Number(r.net_inr))} · gross {formatINR(Number(r.gross_inr))}</span>
                    <span className="muted">UTR {r.utr || "—"}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {hubConnected && (
        <datalist id="acct-names">
          {allAccountNames.map((n) => <option key={n} value={n} />)}
        </datalist>
      )}

      {/* ── Bank statements & the three queues ──────────────────────── */}
      {hubConnected && (
        <div id="bank">
          <h2 className="admin-section-title" style={{ marginTop: 26 }}>🏧 Bank &amp; card statements</h2>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
            Upload each account&apos;s statement (CSV, Excel or PDF). Every line ends in one of three places:
            <strong> matched</strong> (already in Zoho — left alone), <strong>auto</strong> (a taught rule proposes
            the account; one tick posts it), or <strong>ask</strong> (name the account once — the answer becomes a
            rule and that merchant never asks again). Openings must tie to the previous closing, so a missing
            statement cannot hide. ✅ posted/matched so far: {postedLineCount ?? 0}
          </p>

          <form action={uploadStatementAction} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ minWidth: 260 }}>
              <label style={{ fontSize: ".75rem" }}>Account</label>
              <select name="account_name" required style={{ marginBottom: 0 }}>
                <option value="">— pick the bank / card —</option>
                {bankChoices.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: ".75rem" }}>Statement file (CSV / Excel / PDF)</label>
              <input type="file" name="file" required accept=".csv,.txt,.xls,.xlsx,.pdf" style={{ marginBottom: 0 }} />
            </div>
            <SubmitButton className="btn small" savedLabel="✓ Read">📥 Upload &amp; read</SubmitButton>
          </form>

          {stmts.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="btn small secondary as-btn">🗂️ Statements uploaded ({stmts.length})</summary>
              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {stmts.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 10, fontSize: ".82rem", padding: "5px 10px", background: "var(--bg-soft)", borderRadius: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, minWidth: 180 }}>{s.account_name}</span>
                    <span>{s.period_start} → {s.period_end}</span>
                    <span className="muted">{s.lines_total} lines</span>
                    <span>{s.status === "failed" ? "❌ failed" : s.continuity_ok === false ? "⚠️ continuity break" : s.continuity_ok ? "🔗 continuity ✓" : "· first statement"}</span>
                    {s.note && <span style={{ color: "#b45309", fontSize: ".78rem" }}>{s.note}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {autoLines.length > 0 && (
            <>
              <strong style={{ display: "block", marginTop: 14 }}>⚡ Rule-proposed — tick what you want posted ({autoLines.length})</strong>
              <QueuePicker
                rows={autoLines.map((l) => ({
                  id: l.id, date: l.line_date,
                  label: `${l.account_name} · ${String(l.narration).slice(0, 80)}`,
                  sub: l.proposal?.account ? `→ ${l.proposal.account}` : null,
                  amount: Number(l.debit) > 0 ? -Number(l.debit) : Number(l.credit),
                  status: l.status, error: l.error,
                }))}
                approveSelected={approveSelectedLinesAction}
                skipSelected={skipSelectedLinesAction}
              />
            </>
          )}

          {askLines.length > 0 && (
            <>
              <strong style={{ display: "block", marginTop: 14 }}>❓ Needs an answer ({askLines.length}) — answer once, it becomes a rule</strong>
              {askLines.map((l) => (
                <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>{l.line_date}</span>
                    <span style={{ flex: 1, minWidth: 220, fontSize: ".84rem" }}>{l.narration}</span>
                    <strong style={{ whiteSpace: "nowrap" }}>{l.debit > 0 ? `− ${formatINR(Number(l.debit))}` : `+ ${formatINR(Number(l.credit))}`}</strong>
                    <form action={skipLineAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Skip</SubmitButton>
                    </form>
                  </div>
                  <form action={answerLineAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                    <input type="hidden" name="id" value={l.id} />
                    <input name="account" list="acct-names" required placeholder="Which account? (start typing…)" style={{ marginBottom: 0, flex: 1, minWidth: 220, fontSize: ".84rem" }} />
                    <label className="remember" style={{ margin: 0, fontSize: ".78rem", display: "inline-flex", gap: 5, alignItems: "center" }}>
                      <input type="checkbox" name="remember" defaultChecked /> remember rule for
                    </label>
                    <input name="rule_pattern" defaultValue={suggestPattern(l.narration)} style={{ marginBottom: 0, width: 170, fontSize: ".8rem" }} />
                    <SubmitButton className="btn small" savedLabel="✓">✅ Post</SubmitButton>
                  </form>
                </div>
              ))}
            </>
          )}

          {failedLines.length > 0 && (
            <>
              <strong style={{ display: "block", marginTop: 14, color: "#b91c1c" }}>❌ Failed ({failedLines.length})</strong>
              {failedLines.map((l) => (
                <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: "4px solid #b91c1c" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: ".8rem" }}>{l.line_date}</span>
                    <span style={{ flex: 1, minWidth: 200, fontSize: ".84rem" }}>{l.narration}</span>
                    <span style={{ fontSize: ".78rem", color: "#b91c1c" }}>{l.error}</span>
                    <form action={retryLineAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">↻ Back to queue</SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Rule 115 panel: rates + a concise summary of the rule ───── */}
      {hubConnected && (
        <div className="card" style={{ marginTop: 18 }} id="rule115">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <strong>💱 Rule 115 — SBI TT buying rates</strong>
            {r115 && <span style={{ fontSize: "1.1rem", fontWeight: 800 }}>this month: ₹{r115.rate.toFixed(2)}/USD</span>}
            <span className="muted" style={{ fontSize: ".78rem" }}>source: officialforexrates.com (the designated authority)</span>
          </div>
          {monthEnds.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {monthEnds.map((m) => (
                <div key={m.keyDate} style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "6px 12px", fontSize: ".82rem" }}>
                  <div className="muted" style={{ fontSize: ".72rem" }}>{m.keyDate}</div>
                  <strong>{m.rate ? `₹${m.rate.toFixed(2)}` : "—"}</strong>
                  {m.rate && m.rateDate !== m.keyDate && <span className="muted" style={{ fontSize: ".7rem" }}> ({m.rateDate})</span>}
                </div>
              ))}
            </div>
          )}
          {/* The rule itself, said once, plainly — beside the numbers it governs. */}
          <p className="muted" style={{ fontSize: ".8rem", lineHeight: 1.7, margin: "10px 0 0" }}>
            <strong>Rule 115, Income-tax Rules 1962 — in short:</strong> foreign income is converted to rupees at the
            <strong> SBI telegraphic-transfer BUYING rate</strong> on a specified date — for interest, dividends and
            most income: the <strong>last day of the month before</strong> the month the income arose; for capital
            gains: the last day of the month before the <strong>transfer</strong>; for salary: before the month it was
            due. If SBI published nothing that day (holiday), the nearest earlier published rate applies. Every
            conversion this desk makes stores its dollar amount, the rate used, the rate&apos;s date and this rule —
            so any figure can be traced years later.
          </p>
        </div>
      )}

      {/* ── Petty cash (imprest) ────────────────────────────────────── */}
      {hubConnected && (
        <div id="petty">
          <h2 className="admin-section-title" style={{ marginTop: 26 }}>👛 Petty cash — advances</h2>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
            Record an advance <em>after</em> it is paid (it posts to the person&apos;s own Zoho advance account at
            once). The person uploads bills on their <strong>/admin/petty</strong> page; approving a bill books the
            expense and reduces their balance. Give a recipient the <strong>👛 Petty cash</strong> area in
            Admin → Users so they can log their bills.
          </p>

          {pBalances.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {pBalances.map((p) => (
                <div className="card" key={p.personId} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "10px 14px" }}>
                  <strong style={{ minWidth: 130 }}>{p.name}</strong>
                  <span className="muted" style={{ fontSize: ".78rem", flex: 1, minWidth: 160 }}>{p.zohoAccount}{!p.profileId && " · ⚠️ no portal login linked"}</span>
                  <span style={{ fontSize: ".82rem" }}>advanced {formatINR(p.advanced)}</span>
                  <span style={{ fontSize: ".82rem" }}>spent {formatINR(p.spent)}</span>
                  <strong>👛 {formatINR(p.balance)}</strong>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", marginTop: 10 }}>
            <form action={recordAdvanceAction} className="card">
              <strong style={{ fontSize: ".9rem" }}>💸 Record an advance (already paid)</strong>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Person</label>
                  <select name="person_id" required style={{ marginBottom: 0 }}>
                    <option value="">— pick —</option>
                    {pBalances.map((p) => <option key={p.personId} value={p.personId}>{p.name}</option>)}
                  </select>
                </div>
                <div><label style={{ fontSize: ".75rem" }}>Amount (₹)</label><input name="amount" type="number" step="0.01" min="1" required style={{ marginBottom: 0 }} /></div>
                <div><label style={{ fontSize: ".75rem" }}>Date paid</label><input name="adv_date" type="date" required style={{ marginBottom: 0 }} /></div>
                <div>
                  <label style={{ fontSize: ".75rem" }}>Paid from</label>
                  <select name="bank_account_name" required style={{ marginBottom: 0 }}>
                    {bankChoices.map((n) => <option key={n} value={n}>{n}</option>)}
                    <option value="Cash In Hand">Cash In Hand</option>
                    <option value="Petty Cash">Petty Cash</option>
                  </select>
                </div>
              </div>
              <SubmitButton className="btn small" savedLabel="✓ Posted" style={{ marginTop: 8 }}>💸 Record &amp; post</SubmitButton>
            </form>

            <form action={addPettyPersonAction} className="card">
              <strong style={{ fontSize: ".9rem" }}>➕ Add a person</strong>
              <label style={{ fontSize: ".75rem", marginTop: 8 }}>Name</label>
              <input name="name" required placeholder="e.g. Shripal" />
              <label style={{ fontSize: ".75rem" }}>Their portal login email (so they can upload bills)</label>
              <input name="email" type="email" placeholder="person@example.com" />
              <label style={{ fontSize: ".75rem" }}>Zoho advance account (blank = create &ldquo;Name — Advance (AI)&rdquo;)</label>
              <input name="zoho_account_name" list="adv-accts" placeholder="e.g. Pradeep (existing account)" />
              <datalist id="adv-accts">
                {advanceAccountChoices.map((n) => <option key={n} value={n} />)}
              </datalist>
              <SubmitButton className="btn small" savedLabel="✓ Added" style={{ marginTop: 8 }}>➕ Add</SubmitButton>
            </form>
          </div>

          {failedAdvs.length > 0 && failedAdvs.map((a) => (
            <div className="card" key={a.id} style={{ marginTop: 8, borderLeft: "4px solid #b91c1c", padding: "10px 14px" }}>
              <span style={{ fontSize: ".84rem" }}>❌ Advance {formatINR(Number(a.amount))} to {a.person?.name} ({a.adv_date}) failed: <span style={{ color: "#b91c1c" }}>{a.error}</span> — record it again once fixed.</span>
            </div>
          ))}

          {pendingBills.length > 0 && (
            <>
              <strong style={{ display: "block", marginTop: 14 }}>🧾 Bills waiting for approval ({pendingBills.length})</strong>
              {pendingBills.map((b) => (
                <div className="card" key={b.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: b.status === "failed" ? "4px solid #b91c1c" : undefined }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ minWidth: 110 }}>{b.person?.name}</strong>
                    <span style={{ fontSize: ".82rem" }}>{b.bill_date}</span>
                    <strong>{formatINR(Number(b.amount))}</strong>
                    <span style={{ flex: 1, minWidth: 180, fontSize: ".84rem" }}>{b.purpose}</span>
                    {b.file_url && <a className="grad" href={`/api/file?u=${encodeURIComponent(b.file_url)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: ".8rem", fontWeight: 700 }}>📎 bill</a>}
                    {b.status === "failed" && <span style={{ fontSize: ".78rem", color: "#b91c1c" }}>{b.error}</span>}
                  </div>
                  {b.status === "pending" ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                      <form action={approveBillAction} style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 260, margin: 0 }}>
                        <input type="hidden" name="id" value={b.id} />
                        <input name="expense_account" list="acct-names" required placeholder="Expense account (start typing…)" style={{ marginBottom: 0, flex: 1, fontSize: ".84rem" }} />
                        <SubmitButton className="btn small" savedLabel="✓">✅ Approve &amp; post</SubmitButton>
                      </form>
                      <form action={rejectBillAction} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                        <input type="hidden" name="id" value={b.id} />
                        <input name="note" placeholder="reason (optional)" style={{ marginBottom: 0, width: 150, fontSize: ".8rem" }} />
                        <SubmitButton className="btn small secondary" savedLabel="✓">❌ Reject</SubmitButton>
                      </form>
                    </div>
                  ) : (
                    <form action={retryBillAction} style={{ marginTop: 8 }}>
                      <input type="hidden" name="id" value={b.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">↻ Back to pending</SubmitButton>
                    </form>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Brokerage statements ────────────────────────────────────── */}
      {hubConnected && (
        <div id="brokerage">
          <h2 className="admin-section-title" style={{ marginTop: 26 }}>📈 US brokerage, retirement &amp; investment statements</h2>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
            Upload statements from any investment home — brokerages, <strong>retirement accounts (IRA/401k)</strong>,
            managed funds, Treasury Direct, anything else via the free account box. Every transaction is converted at its
            <strong> Rule-115 rate</strong> (shown per line). Dividends, interest, fees and buys come pre-proposed in
            your own account style — this closes the books&apos; one gap: US dividend/interest income. A
            <strong> sell</strong> asks for its INR cost, and the gain/loss books itself.
            ✅ posted so far: {bDone ?? 0}
          </p>

          <form action={uploadBrokerageAction} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ minWidth: 240 }}>
              <label style={{ fontSize: ".75rem" }}>Brokerage / retirement / managed account</label>
              <select name="account_name" style={{ marginBottom: 0 }}>
                <option value="">— pick —</option>
                {brokerageChoices.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 220 }}>
              <label style={{ fontSize: ".75rem" }}>…or any other account</label>
              <input name="account_name_other" list="acct-names" placeholder="type any Zoho account" style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={{ fontSize: ".75rem" }}>Statement (PDF / CSV)</label>
              <input type="file" name="file" required accept=".csv,.pdf" style={{ marginBottom: 0 }} />
            </div>
            <SubmitButton className="btn small" savedLabel="✓ Read">📥 Upload &amp; read</SubmitButton>
          </form>

          {bAuto.length > 0 && (
            <>
              <strong style={{ display: "block", marginTop: 14 }}>⚡ Pre-proposed — tick what you want posted ({bAuto.length})</strong>
              <QueuePicker
                rows={bAuto.map((l) => ({
                  id: l.id, date: l.line_date,
                  label: `${l.account_name} · ${l.kind}${l.symbol ? ` ${l.symbol}` : ""} · $${Number(l.usd_amount).toFixed(2)}`,
                  sub: `${l.rate ? `@ ₹${Number(l.rate).toFixed(2)} (${l.rate_date})` : "rate pending"}${l.proposal?.account ? ` → ${l.proposal.account}` : ""}`,
                  amount: l.inr_amount !== null ? Number(l.inr_amount) : 0,
                  status: l.status, error: l.error,
                }))}
                approveSelected={approveSelectedBrokerageAction}
                skipSelected={skipSelectedBrokerageAction}
              />
            </>
          )}

          {bAsk.length > 0 && (
            <>
              <strong style={{ display: "block", marginTop: 14 }}>❓ Needs an answer ({bAsk.length})</strong>
              {bAsk.map((l) => (
                <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: ".8rem" }}>{l.line_date}</span>
                    <span className="badge">{l.kind}{l.symbol ? ` · ${l.symbol}` : ""}</span>
                    <strong>${Number(l.usd_amount).toFixed(2)}</strong>
                    <span className="muted" style={{ fontSize: ".78rem" }}>{l.rate ? `@ ₹${Number(l.rate).toFixed(2)} = ${formatINR(Number(l.inr_amount))}` : ""}</span>
                    <span style={{ flex: 1, minWidth: 140, fontSize: ".8rem" }} className="muted">{l.description}</span>
                    <form action={skipBrokerageLineAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Skip</SubmitButton>
                    </form>
                  </div>
                  <form action={postBrokerageLineAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                    <input type="hidden" name="id" value={l.id} />
                    {l.kind === "sell" ? (
                      <>
                        <input name="cost_usd" type="number" step="0.01" min="0" required placeholder="USD cost of the lot sold" style={{ marginBottom: 0, width: 200, fontSize: ".84rem" }} />
                        <input name="pl_account" list="acct-names" placeholder="P&L account (default: Profit on Sale of Shares-…)" style={{ marginBottom: 0, flex: 1, minWidth: 220, fontSize: ".84rem" }} />
                      </>
                    ) : (
                      <input name="account" list="acct-names" required placeholder="Which account? (start typing…)" style={{ marginBottom: 0, flex: 1, minWidth: 220, fontSize: ".84rem" }} />
                    )}
                    <SubmitButton className="btn small" savedLabel="✓">✅ Post</SubmitButton>
                  </form>
                </div>
              ))}
            </>
          )}

          {bFailed.length > 0 && bFailed.map((l) => (
            <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: "4px solid #b91c1c" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: ".8rem" }}>{l.line_date} · {l.kind}{l.symbol ? ` ${l.symbol}` : ""} · ${Number(l.usd_amount).toFixed(2)}</span>
                <span style={{ flex: 1, fontSize: ".78rem", color: "#b91c1c" }}>{l.error}</span>
                <form action={retryBrokerageLineAction} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={l.id} />
                  <SubmitButton className="btn small secondary" savedLabel="✓">↻ Back to queue</SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tax worksheets (the founder's alone) ────────────────────── */}
      {isFounder && taxData && (
        <div id="tax">
          <h2 className="admin-section-title" style={{ marginTop: 26 }}>🧾 Tax worksheets — projections, working shown</h2>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
            <div className="card">
              <strong>🇮🇳 Advance tax — FY 2026-27 (A.Y. 2027-28)</strong>
              <div style={{ fontSize: ".84rem", lineHeight: 1.9, marginTop: 8 }}>
                <div>FY-to-date profit (live from Zoho): <strong>{formatINR(taxData.snap.pbt)}</strong> <span className="muted">({taxData.snap.monthsElapsed} months: income {formatINR(taxData.snap.income)} − expenses {formatINR(taxData.snap.expenses)})</span></div>
                <div>Annualised: <strong>{formatINR(taxData.india.annualisedPbt)}</strong> × {taxData.india.effRate}% = est. tax <strong>{formatINR(taxData.india.estTax)}</strong></div>
                <div>Less TDS suffered: {formatINR(taxData.india.tds)} · advance paid: {formatINR(taxData.india.paidSoFar)}</div>
                <div style={{ marginTop: 6 }}>
                  {taxData.india.instalments.map((i) => (
                    <span key={i.due} style={{ display: "inline-block", background: "var(--bg-soft)", borderRadius: 6, padding: "2px 8px", margin: "2px 6px 2px 0", fontSize: ".78rem" }}>
                      {i.due.slice(5)} → {i.cumPct}% = {formatINR(i.cumRequired)}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontWeight: 800 }}>
                  Suggested by {taxData.india.nextDue}: {formatINR(taxData.india.nextRequired)}
                </div>
                <p className="muted" style={{ fontSize: ".74rem", margin: "6px 0 0" }}>A projection for your judgment — capital gains join the ladder in the instalment after they arise.</p>
              </div>
            </div>

            <div className="card">
              <strong>🇺🇸 US estimated tax (1040-ES) — safe harbour</strong>
              <div style={{ fontSize: ".84rem", lineHeight: 1.9, marginTop: 8 }}>
                {taxData.assume.usPriorYearTaxUsd > 0 ? (
                  <>
                    <div>Prior-year total tax: <strong>${taxData.us.priorYearTaxUsd.toLocaleString()}</strong> × 110% = <strong>${taxData.us.safeHarbourUsd.toLocaleString()}</strong></div>
                    <div>Per quarter: <strong>${Math.round(taxData.us.quarterlyUsd).toLocaleString()}</strong></div>
                    <div style={{ marginTop: 6 }}>
                      {taxData.us.quarters.map((q) => (
                        <span key={q.due} style={{ display: "inline-block", background: "var(--bg-soft)", borderRadius: 6, padding: "2px 8px", margin: "2px 6px 2px 0", fontSize: ".78rem" }}>{q.label}: {q.due}</span>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>Next due: {taxData.us.nextDue}</div>
                    <p className="muted" style={{ fontSize: ".74rem", margin: "6px 0 0" }}>Paying 110% of last year&apos;s tax in equal quarters avoids penalty regardless of this year&apos;s income. Your CPA files; this is the calendar and the arithmetic.</p>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: ".82rem" }}>Enter last year&apos;s total US tax below and the safe-harbour schedule appears.</p>
                )}
              </div>
            </div>
          </div>

          <form action={saveTaxAssumptionsAction} className="card" style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: ".75rem" }}>Assumed effective Indian tax rate (%)</label>
              <input name="eff_rate" type="number" step="0.1" min="1" max="60" defaultValue={taxData.assume.effRatePct} style={{ marginBottom: 0, width: 130 }} />
            </div>
            <div>
              <label style={{ fontSize: ".75rem" }}>Prior-year US total tax (USD)</label>
              <input name="us_py_tax" type="number" step="1" min="0" defaultValue={taxData.assume.usPriorYearTaxUsd || ""} style={{ marginBottom: 0, width: 150 }} />
            </div>
            <SubmitButton className="btn small" savedLabel="✓ Saved">💾 Save assumptions</SubmitButton>
            <span className="muted" style={{ fontSize: ".76rem" }}>Only you see this section.</span>
          </form>
        </div>
      )}

      {/* ── Build state ─────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 24 }}>Where the build stands</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {PHASE_PLAN.map((p) => {
          const b = STATE_BADGE[p.state];
          return (
            <div className="card" key={p.name} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "12px 16px" }}>
              <strong style={{ minWidth: 220 }}>{p.name}</strong>
              <span className="muted" style={{ flex: 1, minWidth: 240, fontSize: ".85rem" }}>{p.what}</span>
              <span style={{ color: b.colour, fontWeight: 700, fontSize: ".8rem", whiteSpace: "nowrap" }}>{b.text}</span>
            </div>
          );
        })}
      </div>

      {/* ── Connect Zoho (founder-only) ─────────────────────────────── */}
      {isFounder && (
        <>
          {sp.zoho_ok && <div className="notice ok" style={{ marginTop: 16 }}>✅ {sp.zoho_ok}</div>}
          {sp.zoho_err && <div className="notice err" style={{ marginTop: 16 }}>❌ {sp.zoho_err}</div>}

          <h2 className="admin-section-title" style={{ marginTop: 28 }}>
            🔌 Zoho connection {connected ? <span style={{ color: "#16a34a", fontSize: ".9rem" }}>· ✅ connected (org {orgId})</span> : <span style={{ color: "#b45309", fontSize: ".9rem" }}>· not connected yet</span>}
          </h2>

          {!connected && (
            <div className="card" style={{ marginTop: 8 }}>
              <strong>Five minutes, three pastes — done once, works forever.</strong>
              <ol style={{ fontSize: ".88rem", lineHeight: 1.9, margin: "10px 0 14px", paddingLeft: 20 }}>
                <li>Open <a className="grad" href="https://api-console.zoho.in" target="_blank" rel="noopener noreferrer"><strong>api-console.zoho.in</strong></a> and sign in as the account that runs Zoho Books (<strong>ps@aldine.edu.in</strong>).</li>
                <li>Press <strong>Add Client → Self Client → Create → OK</strong>. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the boxes below.</li>
                <li>Open the <strong>Generate Code</strong> tab. Scope: <code style={{ userSelect: "all" }}>ZohoBooks.fullaccess.all</code> · Duration: <strong>10 minutes</strong> · any description → <strong>Generate</strong>, copy the code into the third box, and press Connect <em>straight away</em> (the code dies in 10 minutes).</li>
              </ol>
              <form action={connectZoho}>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                  <div><label>Client ID</label><input name="client_id" required autoComplete="off" placeholder="1000.XXXXXXXX…" /></div>
                  <div><label>Client Secret</label><input name="client_secret" required type="password" autoComplete="off" placeholder="paste the secret" /></div>
                </div>
                <label>Generated code (valid 10 minutes)</label>
                <input name="grant_code" required autoComplete="off" placeholder="1000.xxxx.xxxx…" />
                <SubmitButton className="btn" savedLabel="Connecting…" style={{ marginTop: 8 }}>🔌 Connect Zoho Books</SubmitButton>
              </form>
              <p className="muted" style={{ fontSize: ".78rem", marginTop: 10 }}>
                The exchange happens on OUR server: console → this page → stored with your other integration keys.
                On success the desk also creates its own <strong>&ldquo;Razorpay Clearing (AI)&rdquo;</strong> and
                <strong> &ldquo;Payment Gateway Charges (AI)&rdquo;</strong> accounts — new accounts with the (AI)
                suffix, no existing account touched.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Provider invoices → Zoho bills ──────────────────────────── */}
      {hubConnected && (
        <div id="bills">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 26 }}>
            <h2 className="admin-section-title" style={{ margin: 0 }}>🧾 Provider invoices → Zoho bills</h2>
            <form action={scanBillsAction} style={{ margin: 0 }}>
              <SubmitButton className="btn small secondary" savedLabel="Scanned">🔄 Read the vault for new bills</SubmitButton>
            </form>
            <form action={recheckBillDatesAction} style={{ margin: 0 }}>
              <SubmitButton className="btn small secondary" savedLabel="Checked">📅 Check posted dates against the paper</SubmitButton>
            </form>
            <form action={readbackBillsAction} style={{ margin: 0 }}>
              <SubmitButton className="btn small secondary" savedLabel="Checked">🔍 Check &amp; finish in Zoho</SubmitButton>
            </form>
            <span className="muted" style={{ fontSize: ".8rem" }}>✅ posted {billsPosted ?? 0}</span>
          </div>
          <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
            Filing the PDF is not the accounting. Each invoice becomes a <strong>vendor bill</strong> — expense
            account, GST position and TDS. Those are your calls, so the desk asks <strong>once per vendor</strong>,
            remembers the answer, and every later invoice from them arrives already proposed. Foreign services post
            under <strong>reverse charge</strong>; the figures convert at their Rule-115 rate.
          </p>

          {/* The team's own door: supplier + file, and it is both filed and queued. */}
          <form action={uploadBillAction} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
            <div style={{ minWidth: 180 }}>
              <label style={{ fontSize: ".75rem" }}>📤 Upload a bill — supplier</label>
              <input name="institution" list="inst-names" required placeholder="e.g. Vercel / HYTONE / BSES" style={{ marginBottom: 0 }} />
            </div>
            <div style={{ minWidth: 150 }}>
              <label style={{ fontSize: ".75rem" }}>Description (optional)</label>
              <input name="title" placeholder="e.g. Aug 2026" style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={{ fontSize: ".75rem" }}>Year</label>
              <input name="year_label" list="year-labels" defaultValue="FY 2026-27" style={{ marginBottom: 0, width: 130 }} />
            </div>
            <div>
              <label style={{ fontSize: ".75rem" }}>The invoice (PDF)</label>
              <input type="file" name="file" required accept="application/pdf,image/*" style={{ marginBottom: 0 }} />
            </div>
            <SubmitButton className="btn small" savedLabel="✓ Filed">📤 File &amp; queue it</SubmitButton>
            <span className="muted" style={{ fontSize: ".76rem" }}>Goes to the vault and into this queue in one step.</span>
          </form>

          {foreignAsk.length > 0 && (
            <>
              <strong style={{ display: "block" }}>🌍 Foreign vendors — the withholding questions ({foreignAsk.length})</strong>
              <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 8px" }}>
                Answer what you can see on the invoice and in the vendor file. The desk works out the rest —
                what to withhold, which part of <strong>Form 145</strong>, and whether an accountant&apos;s
                certificate (<strong>Form 146</strong>) has to come first. Asked <strong>once per vendor</strong>
                and remembered. These are questions of fact; the tax rulings behind them are the founder&apos;s.
              </p>
              {foreignAsk.map((inst) => {
                const mine = bills.filter((b) => b.institution === inst);
                const seed = Object.entries(KNOWN_FOREIGN_VENDORS).find(([k]) => inst.toLowerCase().includes(k.toLowerCase()))?.[1];
                return (
                  <form action={saveForeignAnswersAction} className="card" key={`fq-${inst}`} style={{ marginTop: 8, borderLeft: "4px solid #2563eb" }}>
                    <input type="hidden" name="institution" value={inst} />
                    <strong>{inst}</strong>
                    <span className="muted" style={{ fontSize: ".8rem" }}> · {mine.length} invoice(s) waiting · {mine.map((m) => `${m.currency} ${m.amount ?? "?"}`).join(", ")}</span>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>Where is the vendor?</label>
                        <select name="country" defaultValue={seed?.country ?? ""} required style={{ marginBottom: 0 }}>
                          <option value="">— pick —</option>
                          {FVD.COUNTRIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>What did they actually do?</label>
                        <select name="service_category" defaultValue={seed?.category ?? "standardised"} style={{ marginBottom: 0 }}>
                          <option value="standardised">Ready-made cloud / hosting / software — self-serve</option>
                          <option value="bespoke">Work done for us — consulting, support, custom build</option>
                          <option value="advertising">Online advertising</option>
                          <option value="mixed">A mix of both</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>How often do they bill?</label>
                        <select name="billing_frequency" defaultValue="monthly" style={{ marginBottom: 0 }}>
                          <option value="monthly">Every month</option>
                          <option value="annual">Once a year</option>
                          <option value="one">One-off</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>Expected for the year (₹)</label>
                        <input name="expected_annual" type="number" step="1" placeholder="rough is fine" style={{ marginBottom: 0 }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: ".85rem" }}>
                      <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_trc" style={{ width: "auto", marginRight: 6 }} />Tax residency certificate on file</label>
                      <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_form10f" style={{ width: "auto", marginRight: 6 }} />Form 10F</label>
                      <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_no_pe" style={{ width: "auto", marginRight: 6 }} />No-PE declaration</label>
                      <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_395_cert" style={{ width: "auto", marginRight: 6 }} />s.395 certificate held</label>
                    </div>
                    <SubmitButton className="btn small" savedLabel="✓ Worked out" style={{ marginTop: 10 }}>🧮 Work out {inst}</SubmitButton>
                  </form>
                );
              })}
            </>
          )}

          {foreignOnFile.length > 0 && (
            <details className="card" style={{ marginTop: 8 }}>
              <summary className="btn small secondary as-btn">🌍 Foreign vendors already worked out ({foreignOnFile.length})</summary>
              <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0" }}>
                Change an answer and every invoice of theirs still waiting is worked out again — which is what
                you do when a residency certificate finally arrives, or a <strong>s.395</strong> certificate is granted.
              </p>
              {foreignOnFile.map((r) => (
                <form action={saveForeignAnswersAction} key={`fo-${r.institution}`} style={{ borderTop: "1px solid var(--line, #eee)", padding: "10px 0" }}>
                  <input type="hidden" name="institution" value={r.institution} />
                  <strong>{r.institution}</strong>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: 6 }}>
                    <select name="country" defaultValue={r.country ?? ""} style={{ marginBottom: 0 }}>
                      {FVD.COUNTRIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <select name="service_category" defaultValue={r.service_category ?? "standardised"} style={{ marginBottom: 0 }}>
                      <option value="standardised">Ready-made</option>
                      <option value="bespoke">Work done for us</option>
                      <option value="advertising">Advertising</option>
                      <option value="mixed">Mixed</option>
                    </select>
                    <select name="billing_frequency" defaultValue={r.billing_frequency ?? "monthly"} style={{ marginBottom: 0 }}>
                      <option value="monthly">Every month</option>
                      <option value="annual">Once a year</option>
                      <option value="one">One-off</option>
                    </select>
                    <input name="expected_annual" type="number" defaultValue={r.expected_annual ?? undefined} placeholder="expected ₹/yr" style={{ marginBottom: 0 }} />
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: ".82rem" }}>
                    <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_trc" defaultChecked={r.has_trc} style={{ width: "auto", marginRight: 6 }} />TRC</label>
                    <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_form10f" defaultChecked={r.has_form10f} style={{ width: "auto", marginRight: 6 }} />Form 10F</label>
                    <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_no_pe" defaultChecked={r.has_no_pe} style={{ width: "auto", marginRight: 6 }} />No-PE</label>
                    <label style={{ fontWeight: 400 }}><input type="checkbox" name="has_395_cert" defaultChecked={r.has_395_cert} style={{ width: "auto", marginRight: 6 }} />s.395 certificate</label>
                    <SubmitButton className="btn small secondary" savedLabel="✓ Re-worked">↻ Work out again</SubmitButton>
                  </div>
                </form>
              ))}
            </details>
          )}

          {askVendors.length > 0 && (
            <>
              <strong style={{ display: "block" }}>❓ First invoice from these — how should they be treated? ({askVendors.length})</strong>
              {askVendors.map((inst) => {
                const mine = billsAsk.filter((b) => b.institution === inst);
                const foreign = mine.some((b) => (b.currency || "USD") !== "INR");
                return (
                  <form action={saveBillRuleAction} className="card" key={inst} style={{ marginTop: 8 }}>
                    <input type="hidden" name="institution" value={inst} />
                    <strong>{inst}</strong>
                    <span className="muted" style={{ fontSize: ".8rem" }}> · {mine.length} invoice(s) waiting · {mine.map((m) => `${m.currency} ${m.amount ?? "?"}`).join(", ")}</span>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>Vendor name in Zoho</label>
                        <input name="vendor_name" defaultValue={inst} style={{ marginBottom: 0 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>Expense account</label>
                        <input name="expense_account" list="acct-names" required placeholder="start typing…" style={{ marginBottom: 0 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>GST</label>
                        <select name="gst_treatment" defaultValue={foreign ? "rcm" : "domestic_itc"} style={{ marginBottom: 0 }}>
                          <option value="rcm">Reverse charge — import of services</option>
                          <option value="domestic_itc">Indian vendor charged GST — claim ITC</option>
                          <option value="none">No GST</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>GST rate %</label>
                        <input name="gst_rate" type="number" step="0.01" defaultValue={18} style={{ marginBottom: 0 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>Zoho tax (blank = IGST)</label>
                        <input name="gst_tax_name" placeholder="GST18 if the supplier is in Delhi" style={{ marginBottom: 0 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>TDS section (blank = none)</label>
                        <input name="tds_section" placeholder="e.g. 194J / 195" style={{ marginBottom: 0 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: ".75rem" }}>TDS rate %</label>
                        <input name="tds_rate" type="number" step="0.01" placeholder="—" style={{ marginBottom: 0 }} />
                      </div>
                    </div>
                    <SubmitButton className="btn small" savedLabel="✓ Remembered" style={{ marginTop: 8 }}>💾 Save treatment for {inst}</SubmitButton>
                  </form>
                );
              })}
            </>
          )}

          {billsDraft.length > 0 && (
            <>
              <strong style={{ display: "block", marginTop: 14 }}>⚡ Ready to post ({billsDraft.length})</strong>
              <QueuePicker
                rows={billsDraft.map((b) => ({
                  id: b.id, date: b.bill_date ?? "",
                  label: `${b.institution}${b.bill_no ? ` · ${b.bill_no}` : ""} · ${b.currency} ${b.amount ?? "?"}`,
                  sub: `${b.rate ? `@ ₹${Number(b.rate).toFixed(2)} ` : ""}→ ${b.proposal?.expense_account ?? "?"} · GST ${b.proposal?.gst_treatment ?? "?"}${b.proposal?.tds_section ? ` · TDS ${b.proposal.tds_section}` : ""}` +
                    (b.determination ? ` · withhold ${b.determination.tdsLabel} (${b.determination.confidence})${b.determination.form145Part ? ` · Form 145 Part ${b.determination.form145Part}` : ""}${b.determination.form146Required ? " + Form 146" : ""}` : ""),
                  amount: b.inr_amount !== null ? Number(b.inr_amount) : 0,
                  status: b.status, error: b.error,
                }))}
                approveSelected={approveSelectedBillsAction}
                skipSelected={skipSelectedBillsAction}
                approveLabel="✅ Post selected as bills"
              />
            </>
          )}

          {billsFailed.length > 0 && billsFailed.map((b) => (
            <div className="card" key={b.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: "4px solid #b91c1c" }}>
              <span style={{ fontSize: ".84rem" }}>❌ {b.institution} {b.bill_no ?? ""} — <span style={{ color: "#b91c1c" }}>{b.error}</span></span>
            </div>
          ))}

          {bills.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>No invoices waiting. 🔄 reads the vault for anything not yet booked.</p></div>
          )}

          {complianceRows.length > 0 && (
            <div className="card" style={{ marginTop: 10, borderLeft: "4px solid #b45309" }}>
              <strong>📋 Forms still to file ({complianceRows.length})</strong>
              <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px" }}>
                A remittance is not finished when the bill is booked. Each of these carries a
                <strong> Form 145</strong> — and a Part C one carries its own <strong>Form 146</strong>, which
                cannot be shared with any other remittance.
              </p>
              {complianceRows.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "5px 0", fontSize: ".85rem", borderTop: "1px solid var(--line, #eee)" }}>
                  <span style={{ minWidth: 210 }}>{r.bill_date} · <strong>{r.institution}</strong> {r.bill_no ?? ""}</span>
                  <span>Part {r.form145_part}{r.form146_required ? " + Form 146" : ""}</span>
                  {!r.form145_filed_at && (
                    <form action={markFormFiledAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="which" value="145" />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Form 145 filed</SubmitButton>
                    </form>
                  )}
                  {r.form146_required && !r.form146_filed_at && (
                    <form action={markFormFiledAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="which" value="146" />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Form 146 obtained</SubmitButton>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}

          {billsPostedRows.length > 0 && (
            <details className="card" style={{ marginTop: 10 }}>
              <summary className="btn small secondary as-btn">📗 Posted ({billsPostedRows.length}) — as Zoho holds them</summary>
              <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0" }}>
                Not what was sent — what the books actually hold, re-read with <strong>🔍 Check &amp; finish in Zoho</strong>.
                A foreign bill should show its own currency at the Rule-115 rate and <strong>RCM ✓</strong>, with the
                supplier charging no tax of their own.
              </p>
              {billsPostedRows.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: ".8rem", padding: "4px 0" }}>
                  <span>✅ {r.bill_date} · <strong>{r.institution}</strong> · {r.bill_no ?? "—"}</span>
                  {r.zoho_echo ? (
                    <span className="muted">
                      Zoho: {r.zoho_echo.currency ?? "?"} {r.zoho_echo.total ?? "?"}
                      {r.zoho_echo.exchange_rate && r.zoho_echo.currency !== "INR" ? ` @ ₹${r.zoho_echo.exchange_rate}` : ""}
                      {" · "}{r.zoho_echo.reverse_charge ? "RCM ✓" : "no reverse charge"}
                      {" · supplier tax "}{r.zoho_echo.tax_total ?? 0}
                      {r.zoho_echo.zoho_status ? ` · ${r.zoho_echo.zoho_status}` : ""}
                    </span>
                  ) : <span className="muted">not read back yet</span>}
                  {r.error && <span style={{ color: "#b45309" }}>⚠ {r.error}</span>}
                </div>
              ))}
            </details>
          )}
        </div>
      )}

      {/* ── The document vault — the whole zoho area (founder + Pradeep) ── */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }} id="vault">🗄️ Document vault</h2>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
        Every paper the desk works from — statements, ITRs, computations, challans — indexed by
        <strong> year → institution</strong>, with its type and whether it is the raw file or a processed one.
        Files open through this desk&apos;s own guarded route, never the general file proxy. Deleting is the
        founder&apos;s alone.
      </p>

      <form action={fetchProviderInvoicesAction} style={{ marginTop: 10 }}>
        <SubmitButton className="btn small" savedLabel="✓ Pulled">🔄 Pull provider invoices by API (Bunny + Razorpay)</SubmitButton>
        <span className="muted" style={{ fontSize: ".78rem", marginLeft: 10 }}>
          Bunny hands over the PDFs directly and Razorpay its monthly fee invoices (GST — ITC claimable) — no login, no
          duplicates. Anthropic and Mailgun have no invoice API; theirs arrive by email.
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

      {docGroups.size > 0 && (
        <div style={{ marginTop: 10 }}>
          {[...docGroups.entries()].map(([year, insts]) => (
            <details key={year} open style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: ".95rem" }}>📅 {year} ({[...insts.values()].reduce((s, a) => s + a.length, 0)})</summary>
              {[...insts.entries()].map(([inst, files]) => (
                <div key={inst} style={{ margin: "8px 0 0 14px" }}>
                  <strong style={{ fontSize: ".85rem" }}>🏛️ {inst}</strong>
                  <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                    {files.map((d) => (
                      <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "6px 10px", background: "var(--bg-soft)", borderRadius: 8 }}>
                        <a href={`/api/zoho-vault?d=${d.id}`} target="_blank" rel="noopener noreferrer" className="grad" style={{ fontWeight: 700, fontSize: ".85rem" }}>
                          📄 {d.title}
                        </a>
                        {d.doc_type && <span className="badge" style={{ fontSize: ".7rem" }}>{d.doc_type}</span>}
                        <span className="badge" style={{ fontSize: ".7rem", background: d.is_processed ? "#16a34a" : "var(--muted)", color: "#fff" }}>{d.is_processed ? "processed" : "raw"}</span>
                        {d.note && <span className="muted" style={{ fontSize: ".78rem" }}>{d.note}</span>}
                        <span className="muted" style={{ fontSize: ".74rem", marginLeft: "auto" }}>{formatDate(d.created_at)}</span>
                        {isFounder && <DeleteButton action={deleteVaultDoc} id={d.id} message="Remove this document from the vault? (The stored file itself is kept.)" />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </details>
          ))}
        </div>
      )}


    </section>
  );
}
