import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";
import { getSecret } from "@/lib/secrets";
import { zohoConfigured } from "@/lib/zohoApi";
import { FVD, KNOWN_FOREIGN_VENDORS } from "@/lib/foreignVendorDesk";
import EntryEditor from "./EntryEditor";
import RaiseDocument from "./RaiseDocument";
import SubmitButton from "@/app/components/SubmitButton";
import Money from "@/app/components/Money";
import { journalFromWorkingNote } from "@/lib/brokerageJournal";
import { entryForApproval } from "@/lib/approvalEntry";
import EntryLines from "./EntryLines";
import SectionToggle from "./SectionToggle";
import PdfUpload from "../_components/PdfUpload";
import DeleteButton from "../_components/DeleteButton";
import { addVaultDoc, deleteVaultDoc, connectZoho, scanSalesAction, approvePostingAction, approveAllDraftsAction, skipPostingAction, retryPostingAction, scanSettlementsAction, approveSettlementAction, approveAllSettlementsAction, skipSettlementAction, retrySettlementAction, approveSelectedSettlementsAction, skipSelectedSettlementsAction, approveSelectedLinesAction, skipSelectedLinesAction, approveSelectedBrokerageAction, skipSelectedBrokerageAction, decideBillAction, removeBillAction, matchBankAction, chooseMatchAction, buildBrokerageNoteAction, setSellCostAction, approveBrokerageNoteAction, ingestActivityCsvAction, setUncostedCostAction, rebuildBrokerageNoteAction, attachPaperAction, raiseDocumentAction, retryDocumentAction, approveZohoAction, approveAllZohoAction, rejectZohoAction, saveBillRuleAction, saveForeignAnswersAction, markFormFiledAction, uploadBillAction, approveSelectedBillsAction, skipSelectedBillsAction, uploadStatementAction, answerLineAction, approveAutoLineAction, approveAllAutoAction, skipLineAction, retryLineAction, addPettyPersonAction, recordAdvanceAction, approveBillAction, rejectBillAction, retryBillAction, uploadBrokerageAction, postBrokerageLineAction, approveAllBrokerageAction, skipBrokerageLineAction, retryBrokerageLineAction, saveTaxAssumptionsAction, fetchProviderInvoicesAction } from "./actions";
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
  type NoteRow = { id: string; account_name: string; period_start: string; period_end: string; status: string;
    buckets: Record<string, { label: string; usd: number; inr: number; count: number }>;
    gain_inr: number | null; loss_inr: number | null; note: string | null; error: string | null; zoho_number: string | null;
    workbook: {
      equity: { realisedFifo: number; uncostedProceeds: number; uncostedCost: number | null; subTotal: number;
        opening: { scrip: string; qtySold: number; proceeds: number; avgPrice: number }[];
        scrips: { scrip: string; realised: number; sameDayRoundTrip: boolean; soldFromOpening: boolean }[] };
      options: { net: number; rows: { underlying: string; net: number; contracts: number }[] };
      income: { cashDividends: number; manufacturedDividends: number; stockLending: number; interest: number; subTotal: number };
      charges: { marginInterest: number; fees: number; subTotal: number };
      netResult: number; partial: boolean;
      excluded: { label: string; amount: number }[];
      inrByHead?: Record<string, number>;
      ratesUsed?: { head: string; date: string; rate: number; usd: number; inr: number; count: number }[];
      ratesMissing?: string[];
    } | null };
  const { data: noteData } = hubConnected
    ? await createServiceClient().from("brokerage_notes")
        .select("id, account_name, period_start, period_end, status, buckets, gain_inr, loss_inr, note, error, zoho_number, workbook")
        .order("period_end", { ascending: false }).limit(8)
    : { data: [] as never[] };
  const brokerageNotes = (noteData ?? []) as unknown as NoteRow[];

  type UnpricedSell = { id: string; line_date: string; symbol: string | null; inr_amount: number | null; account_name: string; description: string | null };
  const { data: unpricedData } = hubConnected && brokerageNotes.length
    ? await createServiceClient().from("brokerage_lines")
        .select("id, line_date, symbol, inr_amount, account_name, description")
        .eq("kind", "sell").is("cost_inr", null).neq("status", "skipped")
        .order("line_date", { ascending: false }).limit(25)
    : { data: [] as never[] };
  const unpricedSells = (unpricedData ?? []) as unknown as UnpricedSell[];

  type MatchedLine = { id: string; line_date: string; narration: string; debit: number; credit: number;
    match_kind: string | null; match_label: string | null; match_confidence: string | null;
    match_candidates: { id: string; kind: string; number: string; party: string; balance: number; why: string[] }[] | null };
  const { data: matchedData } = hubConnected
    ? await createServiceClient().from("bank_lines")
        .select("id, line_date, narration, debit, credit, match_kind, match_label, match_confidence, match_candidates")
        .in("status", ["ask", "auto"]).not("match_confidence", "is", null)
        .order("line_date", { ascending: false }).limit(40)
    : { data: [] as never[] };
  const matchedLines = (matchedData ?? []) as unknown as MatchedLine[];

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
  type ProviderBillRow = { id: string; institution: string; bill_no: string | null; bill_date: string | null; currency: string; amount: number | null; inr_amount: number | null; rate: number | null; rate_date: string | null; status: string; proposal: { vendor_name?: string; expense_account?: string; gst_treatment?: string; gst_rate?: number;
      tds_section?: string | null; tds_rate?: number | null;
      // What the document is, and how the withholding is met — remembered per supplier.
      nature?: string | null; operating?: string | null; sub_account?: string | null;
      tds_mode?: string | null; supplier_kind?: string | null } | null; error: string | null;
    determination: { tdsLabel?: string; tdsRate?: number | null; confidence?: string; form145Part?: string | null; form146Required?: boolean; warnings?: string[]; certAdvice?: { why: string; points: string[] } | null; grossedUp?: number | null } | null;
    taxable_value: number | null; cgst_amount: number | null; sgst_amount: number | null; igst_amount: number | null };
  const { data: billData } = hubConnected
    ? await createServiceClient().from("provider_bills")
        .select("id, institution, bill_no, bill_date, currency, amount, inr_amount, rate, rate_date, status, proposal, error, determination, taxable_value, cgst_amount, sgst_amount, igst_amount")
        .in("status", ["needs_info", "draft", "failed"]).order("bill_date")
    : { data: [] as never[] };
  const bills = (billData ?? []) as unknown as ProviderBillRow[];
  // Everything waiting on him before it can reach Zoho.
  const { listPending } = await import("@/lib/zohoApprovals");
  const allPending = hubConnected ? await listPending() : [];
  // A vendor bill the desk has sent up is shown ON ITS OWN LINE in the bills
  // list below, marked as sent — showing it twice, once here and once there,
  // was just two places to decide the same thing.
  const pendingApprovals = allPending.filter((a) => a.kind !== "provider_bill");
  // THE ENTRY BEHIND EACH ONE, WORKED OUT BEFORE THE GATE IS DRAWN.
  //
  // He should not have to open anything to see what releasing an item does to
  // the ledgers. Where an entry cannot be derived honestly the item simply
  // carries no table — never an invented one beside an approve button.
  const approvalEntries = new Map<string, Awaited<ReturnType<typeof entryForApproval>>>();
  await Promise.all(pendingApprovals.map(async (a) => {
    approvalEntries.set(String(a.id), await entryForApproval({
      kind: String(a.kind), ref_table: String(a.ref_table), ref_id: String(a.ref_id),
      details: (a.details ?? null) as Record<string, unknown> | null,
    }));
  }));
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
  const ruleFor = (inst: string) => allRules.find((r) => r.institution === inst);
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

      {/* THE PAGE IN ORDER OF WHO HAS TO DO SOMETHING.
          His complaint, 24 Aug 2026: the page was very lengthy and confusing.
          It ran queues → reference → build notes → and only then his approvals
          gate, roughly fifteen hundred lines down, which is the one thing only
          he can do. The order is now: DECIDE (what is waiting on him), then
          WORK (the desk's queues), then FILES AND REFERENCE. This strip is so
          the page can be jumped through rather than scrolled. */}
      <nav className="card" style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 12px" }}>
        <span className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Decide</span>
        <a className="btn small" href="#approvals">✋ Waiting on you{pendingApprovals.length ? ` (${pendingApprovals.length})` : ""}</a>
        <a className="btn small secondary" href="#bills">🧾 Documents{billsWaiting.length ? ` (${billsWaiting.length})` : ""}</a>
        <span className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, marginLeft: 6 }}>Work</span>
        <a className="btn small secondary" href="#queue">📮 Sales</a>
        <a className="btn small secondary" href="#settlements">🏦 Settlements</a>
        <a className="btn small secondary" href="#bank">🏧 Statements</a>
        <a className="btn small secondary" href="#petty">👛 Petty cash</a>
        <a className="btn small secondary" href="#brokerage">📈 Investments</a>
        <span className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, marginLeft: 6 }}>Files</span>
        <a className="btn small secondary" href="#vault">🗄️ Vault</a>
        <a className="btn small secondary" href="#tax">🧾 Tax</a>
        <a className="btn small secondary" href="#backlog">📋 Backlog</a>
        <span style={{ marginLeft: "auto" }}><SectionToggle /></span>
      </nav>

      {/* The standing rule, said where the person who will live on this page reads it. */}
      <div className="notice" style={{ marginTop: 14, fontSize: ".85rem", lineHeight: 1.7 }}>
        <strong>The one rule of this desk:</strong> Zoho is written to, never worked in. Every entry starts here,
        gets approved here, and is pushed with its portal reference — so nothing ever posts twice, and a correction
        is a fresh entry, never a silent edit. Bank feeds inside Zoho stay <strong>disconnected</strong>.
      </div>

      {/* ── His gate: nothing reaches Zoho until he releases it ──────── */}
      {hubConnected && (
        <div id="approvals">
          <h2 className="admin-section-title" style={{ marginTop: 26 }}>
            ✋ Waiting for your approval ({pendingApprovals.length})
          </h2>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
            Nothing is written to Zoho from anywhere in this system — no posting, no date, no amount, no vendor,
            no TDS — until you release it here. The desk prepares the work and asks; this page is the only door,
            and it is <strong>yours alone</strong>. Everything below shows exactly what will be sent.
          </p>

          {pendingApprovals.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing waiting. The books are as you left them.</p></div>
          ) : !isFounder ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                {pendingApprovals.length} item(s) are with CA Parveen Sharma for approval. They post once he releases them.
              </p>
            </div>
          ) : (
            <>
              <form action={approveAllZohoAction} className="card" style={{ marginBottom: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {pendingApprovals.map((a) => <input key={a.id} type="hidden" name="ids" value={a.id} />)}
                <SubmitButton className="btn small" savedLabel="Posted">
                  {pendingApprovals.length === 1 ? "✅ Approve and post" : `✅ Approve all ${pendingApprovals.length} and post`}
                </SubmitButton>
                <span className="muted" style={{ fontSize: ".8rem" }}>Or go through them one at a time below.</span>
              </form>

              {pendingApprovals.map((a) => (
                <div className="card" key={a.id} style={{ marginTop: 8, borderLeft: "4px solid #b45309" }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: "1 1 420px" }}>
                      <span className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em" }}>
                        {a.kind.replace(/_/g, " ")}
                      </span>
                      <div style={{ fontSize: ".95rem", marginTop: 2 }}>{a.summary}</div>
                      {(() => {
                        const e = approvalEntries.get(String(a.id));
                        return e
                          ? <EntryLines entry={e} title="What approving this does to the ledgers" compact />
                          : (
                            <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>
                              The entry for this one cannot be shown here — open it on its own section below before you release it.
                            </p>
                          );
                      })()}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <form action={approveZohoAction} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton className="btn small" savedLabel="Posted">✅ Approve</SubmitButton>
                      </form>
                      <form action={rejectZohoAction} style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton className="btn small secondary" savedLabel="Rejected">✕ No</SubmitButton>
                      </form>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Bills: one line each, opened only when he wants it ──────── */}
      {hubConnected && (
        <div id="bills">
          <h2 className="admin-section-title" style={{ marginTop: 26 }}>🧾 Documents to approve ({billsWaiting.length})</h2>
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
            const tdsRate = d?.tdsRate ?? p.tds_rate ?? null;
            const tdsAmt = tdsRate ? Math.round(inr * Number(tdsRate)) / 100 : 0;
            const waitingOnHim = pendingBillIds.has(b.id);

            // The one line. Everything he needs to decide whether to open it.
            const headline = needAnswers
              ? "needs two answers before it can be worked out"
              : !inr ? "amount could not be read — open and type it in"
              : `${p.gst_treatment === "rcm" ? "RCM 18%" : p.gst_treatment === "none" ? "no GST" : "GST 18% ITC"}` +
                `${tdsRate ? ` · TDS ${tdsRate}% = ₹${tdsAmt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : " · no TDS"}` +
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
                    {waitingOnHim && <span style={{ fontSize: ".75rem", color: "#b45309" }}>· sent to you by the desk</span>}
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
                          {isFounder ? "✅ Approve & post to Zoho" : "📤 Send for approval"}
                        </SubmitButton>
                        <label style={{ fontWeight: 400, fontSize: ".8rem" }}>
                          <input type="checkbox" name="as_rule" value="yes" defaultChecked style={{ width: "auto", marginRight: 6 }} />
                          Remember all of this for {b.institution}
                        </label>
                      </div>
                    </form>
                  )}

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
        </div>
      )}

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
        <details id="queue" data-sec open className="zoho-sec">
          <summary className="admin-section-title" style={{ cursor: "pointer", marginTop: 26 }}>📮 Sales → Zoho</summary>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 24 }}>
            <form action={scanSalesAction} style={{ margin: 0 }}>
              <SubmitButton className="btn small secondary" savedLabel="Scanned">🔄 Scan for new sales</SubmitButton>
            </form>
            {drafts.length > 0 && (
              <form action={approveAllDraftsAction} style={{ margin: 0 }}>
                <SubmitButton className="btn small" savedLabel="📤 Sent for approval">📤 Send all {drafts.length} draft(s) for approval</SubmitButton>
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
                      <SubmitButton className="btn small" savedLabel="📤 Sent for approval">📤 Send for approval</SubmitButton>
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
        </details>
      )}

      {/* ── Razorpay settlements → Zoho ─────────────────────────────── */}
      {hubConnected && (
        <details id="settlements" data-sec open className="zoho-sec">
          <summary className="admin-section-title" style={{ cursor: "pointer", marginTop: 26 }}>🏦 Razorpay settlements → Zoho</summary>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 26 }}>
            <form action={scanSettlementsAction} style={{ margin: 0 }}>
              <SubmitButton className="btn small secondary" savedLabel="Scanned">🔄 Fetch settlements</SubmitButton>
            </form>
            {sDrafts.length > 0 && (
              <form action={approveAllSettlementsAction} style={{ margin: 0 }}>
                <SubmitButton className="btn small" savedLabel="📤 Sent for approval">📤 Send all {sDrafts.length} for approval</SubmitButton>
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
        </details>
      )}

      {hubConnected && (
        <datalist id="acct-names">
          {allAccountNames.map((n) => <option key={n} value={n} />)}
        </datalist>
      )}

      {/* ── Bank statements & the three queues ──────────────────────── */}
      {hubConnected && (
        <details id="bank" data-sec open className="zoho-sec">
          <summary className="admin-section-title" style={{ cursor: "pointer", marginTop: 26 }}>🏧 Bank &amp; card statements</summary>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
            Upload each account&apos;s statement (CSV, Excel or PDF). Every line ends in one of three places:
            <strong> matched</strong> (already in Zoho — left alone), <strong>auto</strong> (a taught rule proposes
            the account; one tick posts it), or <strong>ask</strong> (name the account once — the answer becomes a
            rule and that merchant never asks again). Openings must tie to the previous closing, so a missing
            statement cannot hide. ✅ posted/matched so far: {postedLineCount ?? 0}
          </p>

          <div className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <form action={matchBankAction} style={{ margin: 0 }}>
                <SubmitButton className="btn small secondary" savedLabel="Matched">🔗 Find what these payments settle</SubmitButton>
              </form>
              <span className="muted" style={{ fontSize: ".8rem" }}>
                Asks Zoho what is still unpaid and looks for the bill or invoice each line clears.
              </span>
            </div>
            {matchedLines.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <strong style={{ fontSize: ".85rem" }}>Settlements found ({matchedLines.length})</strong>
                <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 8px" }}>
                  A payment to a supplier is <strong>not</strong> an expense — the expense came with their bill. These
                  post as a payment against the bill, or a receipt against the invoice, so the document is actually
                  cleared. Approve them in the list below as usual.
                </p>
                {matchedLines.map((m) => (
                  <div key={m.id} style={{ padding: "6px 0", borderTop: "1px solid rgba(0,0,0,.06)", fontSize: ".83rem" }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                      <span style={{ minWidth: 88 }}>{m.line_date}</span>
                      <Money n={Number(m.debit) > 0 ? -Number(m.debit) : Number(m.credit)} width={116} sign bold />
                      <span className="muted" style={{ flex: "1 1 220px" }}>{String(m.narration).slice(0, 70)}</span>
                      {m.match_confidence === "choose" ? (
                        <form action={chooseMatchAction} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={m.id} />
                          <select name="doc_id" defaultValue="" style={{ marginBottom: 0, minWidth: 260 }}>
                            <option value="">— which one does this settle? —</option>
                            {(m.match_candidates ?? []).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.number || c.kind} · {c.party} · ₹{Number(c.balance).toLocaleString("en-IN")}
                              </option>
                            ))}
                            <option value="__none">None of these — treat it normally</option>
                          </select>
                          <SubmitButton className="btn small secondary" savedLabel="✓">Use this</SubmitButton>
                        </form>
                      ) : (
                        <>
                          <span style={{ color: "#0e6e52" }}>{m.match_label}</span>
                          <span className="muted" style={{ fontSize: ".75rem" }}>
                            {m.match_confidence === "certain" ? "certain" : "likely"}
                            {(m.match_candidates?.[0]?.why ?? []).length ? ` — ${m.match_candidates![0].why.join(", ")}` : ""}
                          </span>
                          <form action={chooseMatchAction} style={{ margin: 0 }}>
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="doc_id" value="__none" />
                            <SubmitButton className="btn small secondary" savedLabel="✓">Not this</SubmitButton>
                          </form>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
        </details>
      )}

      {/* ── Rule 115 panel: rates + a concise summary of the rule ───── */}
      {hubConnected && (
        <details className="card" style={{ marginTop: 18 }} id="rule115">
          {/* REFERENCE, NOT A TASK. Rule 115 is something to look up when a
              foreign figure is being checked — it is not work waiting to be
              done, and open by default it pushed the actual queues further down
              a page he already found too long. */}
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: ".92rem" }}>
            💱 Rule 115 — SBI TT buying rates{r115 ? ` · this month ₹${r115.rate.toFixed(2)}/USD` : ""}
          </summary>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
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
        </details>
      )}

      {/* ── Petty cash (imprest) ────────────────────────────────────── */}
      {hubConnected && (
        <details id="petty" data-sec open className="zoho-sec">
          <summary className="admin-section-title" style={{ cursor: "pointer", marginTop: 26 }}>👛 Petty cash — advances</summary>
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
              {/* NOBODY TO PAY IT TO, AND THE FORM DID NOT SAY SO.
                  With petty_people empty the Person list held nothing but
                  "— pick —", and recordAdvanceAction returns silently when no
                  person is chosen. So the amount, the date and the bank could
                  all be filled in, "Record & post" pressed, and nothing at all
                  happened — no entry, no error, no explanation. */}
              {pBalances.length === 0 && (
                <p className="notice err" style={{ fontSize: ".8rem", margin: "8px 0 0", lineHeight: 1.6 }}>
                  There is nobody to record an advance against yet, so this form cannot do anything.
                  Add the person first with <strong>➕ Add a person</strong> beside this and they
                  will appear in the list. (If you have added people already, this list is also
                  what you see when Zoho cannot be reached to read their balances.)
                </p>
              )}
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 8 }}>
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
        </details>
      )}

      {/* ── Brokerage statements ────────────────────────────────────── */}
      {hubConnected && (
        <details id="brokerage" data-sec open className="zoho-sec">
          <summary className="admin-section-title" style={{ cursor: "pointer", marginTop: 26 }}>📈 US brokerage, retirement &amp; investment statements</summary>
          <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
            Upload statements from any investment home — brokerages, <strong>retirement accounts (IRA/401k)</strong>,
            managed funds, Treasury Direct, anything else via the free account box. Every transaction is converted at its
            <strong> Rule-115 rate</strong> (shown per line). Dividends, interest, fees and buys come pre-proposed in
            your own account style — this closes the books&apos; one gap: US dividend/interest income. A
            <strong> sell</strong> asks for its INR cost, and the gain/loss books itself.
            ✅ posted so far: {bDone ?? 0}
          </p>

          <div className="card" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: ".9rem" }}>📝 The working note</strong>
            <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px" }}>
              A statement is not journalled line by line. It is summarised into what actually happened over the
              period — interest, dividends, charges, option premium each way, what shares cost and what they
              fetched — and the gain or loss falls out of that, every figure at its own Rule-115 rate. You read and
              correct the note; the journal follows from it.
            </p>
            <form action={ingestActivityCsvAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
              <div style={{ minWidth: 210 }}>
                <label style={{ fontSize: ".75rem" }}>Account</label>
                <select name="account_name" required style={{ marginBottom: 0 }}>
                  {brokerageChoices.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: ".75rem" }}>From</label>
                <input name="from" type="date" required defaultValue={`${fyNow.slice(3, 7)}-04-01`} style={{ marginBottom: 0 }} />
              </div>
              <div>
                <label style={{ fontSize: ".75rem" }}>To</label>
                <input name="to" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} style={{ marginBottom: 0 }} />
              </div>
              <div style={{ minWidth: 200 }}>
                <label style={{ fontSize: ".75rem" }}>The broker&apos;s activity file (CSV)</label>
                <input type="file" name="file" required accept=".csv,text/csv" style={{ marginBottom: 0 }} />
              </div>
              <SubmitButton className="btn small" savedLabel="Prepared">📝 Build the working note</SubmitButton>
            </form>

            <details style={{ marginBottom: 8 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: ".78rem" }}>
                …or summarise lines already parsed from a statement
              </summary>
              <form action={buildBrokerageNoteAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
              <div style={{ minWidth: 220 }}>
                <label style={{ fontSize: ".75rem" }}>Account</label>
                <select name="account_name" required style={{ marginBottom: 0 }}>
                  {brokerageChoices.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: ".75rem" }}>From</label>
                <input name="from" type="date" defaultValue={`${fyNow.slice(3, 7)}-04-01`} style={{ marginBottom: 0 }} />
              </div>
              <div>
                <label style={{ fontSize: ".75rem" }}>To</label>
                <input name="to" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={{ marginBottom: 0 }} />
              </div>
                <SubmitButton className="btn small secondary" savedLabel="Prepared">Summarise those lines</SubmitButton>
              </form>
            </details>

            {brokerageNotes.map((n) => {
              const rows = Object.entries(n.buckets ?? {}).filter(([, b]) => b && b.count > 0);
              return (
                <details className="card" key={n.id} style={{ marginTop: 10 }} open={n.status === "draft"}>
                  <summary style={{ cursor: "pointer" }}>
                    <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                      <strong>{n.account_name}</strong>
                      <span className="muted" style={{ fontSize: ".82rem" }}>{n.period_start} → {n.period_end}</span>
                      <span style={{ fontSize: ".82rem" }}>
                        {n.status === "posted" ? `✅ journalled${n.zoho_number ? ` · ${n.zoho_number}` : ""}`
                          : n.status === "approved" ? "with CA Parveen Sharma"
                          : n.status === "failed" ? `❌ ${n.error}` : "draft"}
                      </span>
                    </span>
                  </summary>
                  {n.workbook ? (() => {
                    const w = n.workbook!;
                    const usd = (x: number) => (x < 0 ? "-" : "") + "$" + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const inr = (k: string) => {
                      const v = w.inrByHead?.[k];
                      return v === undefined ? "" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    };
                    const Row = ({ label, amount, inrKey, bold, indent }: { label: string; amount: number; inrKey?: string; bold?: boolean; indent?: boolean }) => (
                      <tr style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                        <td style={{ padding: "5px 8px", paddingLeft: indent ? 22 : 8, fontWeight: bold ? 600 : 400 }}>{label}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap", fontWeight: bold ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>{usd(amount)}</td>
                        <td className="muted" style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap", fontSize: ".8rem" }}>{inrKey ? inr(inrKey) : ""}</td>
                      </tr>
                    );
                    return (
                      <div style={{ marginTop: 10, overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
                          <thead>
                            <tr><th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".72rem", letterSpacing: ".06em", color: "#666" }}>PARTICULARS</th>
                              <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".72rem", color: "#666" }}>USD</th>
                              <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".72rem", color: "#666" }}>₹ (RULE 115)</th></tr>
                          </thead>
                          <tbody>
                            <tr><td colSpan={3} style={{ padding: "8px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>A · CAPITAL GAINS — EQUITY / ETF</td></tr>
                            <Row label="Realised gain / (loss) — FIFO, cost carried from date of purchase" amount={w.equity.realisedFifo} inrKey="equityRealised" indent />
                            <Row label="Sale proceeds of shares with no recorded purchase cost" amount={w.equity.uncostedProceeds} indent />
                            <Row label="Less: cost of those shares" amount={w.equity.uncostedCost ?? 0} indent />
                            <Row label={`Sub-total — equity${w.partial ? " (EXCLUDES the uncosted sales)" : ""}`} amount={w.equity.subTotal} bold />

                            <tr><td colSpan={3} style={{ padding: "10px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>B · CAPITAL GAINS — OPTIONS (premium / cash basis)</td></tr>
                            <Row label="Net premium realised on options" amount={w.options.net} inrKey="options" indent />

                            <tr><td colSpan={3} style={{ padding: "10px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>C · INVESTMENT INCOME</td></tr>
                            <Row label="Cash dividends (CDIV)" amount={w.income.cashDividends} inrKey="cashDividends" indent />
                            <Row label="Manufactured / substitute dividends (MDIV) — ordinary income, no treaty dividend rate" amount={w.income.manufacturedDividends} inrKey="manufacturedDividends" indent />
                            <Row label="Stock lending income (SLIP)" amount={w.income.stockLending} inrKey="stockLending" indent />
                            <Row label="Interest on idle cash (INT)" amount={w.income.interest} inrKey="interest" indent />
                            <Row label="Sub-total — investment income" amount={w.income.subTotal} bold />

                            <tr><td colSpan={3} style={{ padding: "10px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>D · EXPENSES / CHARGES</td></tr>
                            <Row label="Margin interest paid, net of credits (MINT)" amount={w.charges.marginInterest} inrKey="marginInterest" indent />
                            <Row label="Fees" amount={w.charges.fees} inrKey="fees" indent />
                            <Row label="Sub-total — charges" amount={w.charges.subTotal} bold />

                            <tr style={{ borderTop: "2px solid rgba(0,0,0,.25)" }}>
                              <td style={{ padding: "8px", fontWeight: 700 }}>NET RESULT FOR THE PERIOD{w.partial ? " — PARTIAL" : ""}</td>
                              <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{usd(w.netResult)}</td>
                              <td />
                            </tr>
                          </tbody>
                        </table>

                        {/* THE NOTE AS A FILE, AND THE RATES IT STANDS ON.
                            A working note that lives only inside a web page is
                            no use at assessment, and a converted figure nobody
                            can re-perform is worth no more than a guess. */}
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                          <a className="btn small secondary" href={`/admin/zoho/brokerage/${n.id}/export`} download>
                            ⬇️ Download the working note (Excel)
                          </a>
                          <span className="muted" style={{ fontSize: ".75rem" }}>
                            The same statement as above — A, B, C, D and the net result — with the FIFO trades, the
                            scrip summary, the option rows, the income and charge detail and every rate on their own sheets.
                          </span>
                        </div>

                        {(w.ratesUsed?.length ?? 0) > 0 && (() => {
                          const rates = w.ratesUsed!;
                          const lo = Math.min(...rates.map((r) => r.rate));
                          const hi = Math.max(...rates.map((r) => r.rate));
                          const HEADS: Record<string, string> = {
                            equityRealised: "Equity — realised", options: "Options — net premium",
                            cashDividends: "Cash dividends", manufacturedDividends: "Manufactured dividends",
                            stockLending: "Stock lending", interest: "Interest",
                            marginInterest: "Margin interest", fees: "Fees",
                          };
                          return (
                            <details style={{ marginTop: 8 }}>
                              <summary className="muted" style={{ cursor: "pointer", fontSize: ".78rem" }}>
                                💱 The rates applied — {rates.length} date-wise rates, ₹{lo.toFixed(2)} to ₹{hi.toFixed(2)} per USD
                              </summary>
                              <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0" }}>
                                Rule 115 converts each receipt at the telegraphic transfer buying rate of <strong>its own
                                date</strong>, so there is no single rate for the period and no average is used. Every one
                                is here, against the head it converted.
                              </p>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
                                  <thead><tr>
                                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>HEAD</th>
                                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>DATE</th>
                                    <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>RATE ₹/USD</th>
                                    <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>USD</th>
                                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>₹</th>
                                  </tr></thead>
                                  <tbody>
                                    {rates.map((r) => (
                                      <tr key={`${r.head}-${r.date}`} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                                        <td style={{ padding: "4px 8px" }}>{HEADS[r.head] ?? r.head}</td>
                                        <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{r.date}</td>
                                        <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rate.toFixed(4)}</td>
                                        <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(r.usd)}</td>
                                        <td style={{ padding: "4px 8px" }}><Money n={r.inr} width={120} /></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          );
                        })()}

                        {n.status === "draft" && !(w.ratesUsed?.length) && (
                          <form action={rebuildBrokerageNoteAction} style={{ marginTop: 8 }}>
                            <input type="hidden" name="id" value={n.id} />
                            <SubmitButton className="btn small secondary" savedLabel="✓ Rebuilt">
                              💱 Work it out again and show the rates
                            </SubmitButton>
                            <span className="muted" style={{ fontSize: ".75rem", marginLeft: 8 }}>
                              This note was prepared before the desk kept the rates it used. The activity file is still
                              here, so it can be worked out again from it — same figures, with every Rule 115 rate shown.
                            </span>
                          </form>
                        )}

                        {(w.ratesMissing?.length ?? 0) > 0 && (
                          <p style={{ fontSize: ".77rem", marginTop: 6, color: "#b45309" }}>
                            ⚠ No Rule 115 rate was available for {w.ratesMissing!.join(", ")}. Those transactions carry no
                            rupee figure — a neighbouring day&apos;s rate is not substituted for a missing one.
                          </p>
                        )}

                        {w.excluded.length > 0 && (
                          <p className="muted" style={{ fontSize: ".78rem", marginTop: 8 }}>
                            <strong>Excluded as capital / non-income movements:</strong>{" "}
                            {w.excluded.map((e) => `${e.label} ${usd(e.amount)}`).join(" · ")}
                          </p>
                        )}
                        {w.equity.scrips.some((sc) => sc.sameDayRoundTrip) && (
                          <p className="muted" style={{ fontSize: ".76rem", marginTop: 4 }}>
                            Bought and sold on the same day, where the file carries no execution times, so which fill
                            came first is an assumption: {w.equity.scrips.filter((sc) => sc.sameDayRoundTrip).map((sc) => sc.scrip).join(", ")}.
                          </p>
                        )}

                        {n.status === "draft" && w.equity.uncostedProceeds > 0 && (
                          <div className="card" style={{ marginTop: 10, background: "rgba(234,179,8,.08)" }}>
                            <strong style={{ fontSize: ".83rem" }}>Sales with no purchase cost in the file</strong>
                            <p className="muted" style={{ fontSize: ".77rem", margin: "2px 0 6px" }}>
                              Shares held before this file begins. Until their cost is here the equity sub-total and the
                              net result leave them out — proceeds without a cost are not a gain.
                            </p>
                            <div style={{ fontSize: ".8rem", marginBottom: 8 }}>
                              {w.equity.opening.map((o) => (
                                <div key={o.scrip}>{o.scrip} — {o.qtySold.toFixed(4)} sold for {usd(o.proceeds)} (avg {usd(o.avgPrice)})</div>
                              ))}
                            </div>
                            <form action={setUncostedCostAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input type="hidden" name="note_id" value={n.id} />
                              <label style={{ fontSize: ".78rem", fontWeight: 400 }}>Total cost of all of the above (USD)</label>
                              <input name="cost" type="number" step="0.01" defaultValue={w.equity.uncostedCost ?? ""} style={{ marginBottom: 0, width: 160 }} />
                              <SubmitButton className="btn small secondary" savedLabel="✓">Save the cost</SubmitButton>
                            </form>
                          </div>
                        )}

                        {/* ── WHAT APPROVING WILL ACTUALLY DO ──────────────────
                            He said plainly that he does not know what happens if
                            he presses the button, and he was right not to know:
                            the entry was worked out inside the approval, so
                            nothing showed it to him first. It is worked out in
                            one place now — lib/brokerageJournal.ts — and this is
                            that same entry, line for line. What he approves is
                            what gets posted. */}
                        {(() => {
                          const j = journalFromWorkingNote({
                            account_name: n.account_name, period_start: n.period_start,
                            period_end: n.period_end, workbook: w as never,
                          });
                          if (j.lines.length < 2) return null;
                          const dr = j.lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0);
                          const cr = j.lines.filter((l) => l.side === "credit").reduce((t, l) => t + l.amount, 0);
                          const known = new Set(allAccountNames.map((a) => a.toLowerCase()));
                          const missing = [...new Set(j.lines.map((l) => l.account))].filter((a) => !known.has(a.toLowerCase()));
                          return (
                            <details className="card" style={{ marginTop: 12, background: "rgba(14,110,82,.05)" }} open={n.status === "draft"}>
                              <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: ".88rem" }}>
                                🧾 The journal entry this becomes — {j.lines.length} lines, ₹{dr.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each side
                              </summary>
                              <p style={{ fontSize: ".8rem", margin: "8px 0 6px" }}>
                                {n.status === "draft"
                                  ? <><strong>Nothing is in Zoho yet.</strong> This is the entry that will be written there
                                      when you approve — these accounts, these amounts, this narration, dated {n.period_end}.
                                      It is worked out by the same code that posts it, so what you see here is what goes in.</>
                                  : <>This is the entry that was posted{n.zoho_number ? ` as ${n.zoho_number}` : ""}.</>}
                              </p>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                                  <thead><tr>
                                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>LEDGER</th>
                                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>DEBIT</th>
                                    <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>CREDIT</th>
                                  </tr></thead>
                                  <tbody>
                                    {j.lines.map((l, i) => (
                                      <tr key={`${l.account}-${i}`} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                                        <td style={{ padding: "5px 8px" }}>
                                          <strong>{l.account}</strong>
                                          {!known.has(l.account.toLowerCase()) && (
                                            <span style={{ color: "#b45309", fontSize: ".72rem" }}> · new — will be created as &ldquo;{l.account} (AI)&rdquo;</span>
                                          )}
                                          <div className="muted" style={{ fontSize: ".72rem" }}>{l.note}</div>
                                        </td>
                                        <td style={{ padding: "5px 8px" }}>{l.side === "debit" ? <Money n={l.amount} width={124} /> : null}</td>
                                        <td style={{ padding: "5px 8px" }}>{l.side === "credit" ? <Money n={l.amount} width={124} /> : null}</td>
                                      </tr>
                                    ))}
                                    <tr style={{ borderTop: "2px solid rgba(0,0,0,.2)" }}>
                                      <td style={{ padding: "6px 8px", fontWeight: 700 }}>Total</td>
                                      <td style={{ padding: "6px 8px" }}><Money n={dr} width={124} bold /></td>
                                      <td style={{ padding: "6px 8px" }}><Money n={cr} width={124} bold /></td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                              <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>
                                {Math.abs(dr - cr) < 0.01
                                  ? "✅ It balances. Zoho refuses a journal that does not, and this is checked again before it is sent."
                                  : `⚠ It does not balance — debits ${formatINR(dr)} against credits ${formatINR(cr)}. It will not be sent in this state.`}
                                {missing.length > 0 && (
                                  <>{" "}{missing.length} ledger{missing.length === 1 ? "" : "s"} named here{" "}
                                    {missing.length === 1 ? "does" : "do"}{" "}not exist in Zoho yet and will be created
                                    with the &ldquo;(AI)&rdquo; suffix, never by renaming or merging one of yours:{" "}
                                    {missing.join(", ")}.</>
                                )}
                                {" "}The broker&apos;s own CSV is attached to the entry in Zoho, so the file that justifies it
                                travels with it.
                              </p>
                            </details>
                          );
                        })()}

                        {n.status === "draft" && (
                          <form action={approveBrokerageNoteAction} style={{ marginTop: 10 }}>
                            <input type="hidden" name="id" value={n.id} />
                            <SubmitButton className="btn small" savedLabel="✓ Journalled">
                              {isFounder ? "✅ Approve — post this entry to Zoho now" : "📤 Send the note to CA Parveen Sharma"}
                            </SubmitButton>
                            <span className="muted" style={{ fontSize: ".75rem", marginLeft: 8 }}>
                              {isFounder
                                ? "This is the only step. Pressing it writes the entry above into Zoho Books straight away, with the CSV attached, and tells you the entry number it got — or exactly why it would not go."
                                : "It goes to CA Parveen Sharma for approval. Nothing reaches Zoho until he releases it."}
                            </span>
                          </form>
                        )}
                      </div>
                    );
                  })() : (
                  <div style={{ marginTop: 10, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
                      <tbody>
                        {rows.map(([k, b]) => (
                          <tr key={k} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                            <td style={{ padding: "6px 8px" }}>{b.label}</td>
                            <td className="muted" style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{b.count} txn</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>${b.usd.toFixed(2)}</td>
                            <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                              <Money n={b.inr} width="100%" bold />
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid rgba(0,0,0,.2)" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>Realised gain</td>
                          <td colSpan={2} />
                          <td style={{ padding: "6px 8px", color: "#0e6e52" }}>
                            <Money n={Number(n.gain_inr ?? 0)} width="100%" bold />
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>Realised loss</td>
                          <td colSpan={2} />
                          <td style={{ padding: "6px 8px", color: "#b91c1c" }}>
                            <Money n={Number(n.loss_inr ?? 0)} width="100%" bold />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {n.note && <p style={{ color: "#b45309", fontSize: ".82rem", margin: "8px 0 0" }}>⚠ {n.note}</p>}

                    {n.status === "draft" && unpricedSells.filter((u) => u.account_name === n.account_name).length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <strong style={{ fontSize: ".83rem" }}>Sales still needing their cost</strong>
                        <p className="muted" style={{ fontSize: ".76rem", margin: "2px 0 6px" }}>
                          What those shares originally cost in rupees, at their own purchase-date rate. Until it is
                          here the sale has proceeds and no gain — which is why the note will not pretend to one.
                        </p>
                        {unpricedSells.filter((u) => u.account_name === n.account_name).map((u) => (
                          <form action={setSellCostAction} key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "3px 0" }}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="note_id" value={n.id} />
                            <span style={{ minWidth: 88, fontSize: ".8rem" }}>{u.line_date}</span>
                            <span style={{ minWidth: 70, fontWeight: 600 }}>{u.symbol ?? "—"}</span>
                            <span className="muted" style={{ minWidth: 110, fontSize: ".8rem" }}>
                              got ₹{Math.round(Number(u.inr_amount ?? 0)).toLocaleString("en-IN")}
                            </span>
                            <input name="cost_inr" type="number" step="0.01" placeholder="cost ₹" style={{ marginBottom: 0, width: 130 }} />
                            <SubmitButton className="btn small secondary" savedLabel="✓">Save</SubmitButton>
                          </form>
                        ))}
                      </div>
                    )}

                    {n.status === "draft" && (
                      <form action={approveBrokerageNoteAction} style={{ marginTop: 10 }}>
                        <input type="hidden" name="id" value={n.id} />
                        <SubmitButton className="btn small" savedLabel="✓ Journalled">
                          {isFounder ? "✅ Approve the note & journal it" : "📤 Send the note for approval"}
                        </SubmitButton>
                        <span className="muted" style={{ fontSize: ".78rem", marginLeft: 8 }}>
                          Income, charges and the realised gain go in; the shares themselves move on their own lines.
                        </span>
                      </form>
                    )}
                  </div>
                  )}
                </details>
              );
            })}
          </div>

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
        </details>
      )}

      {/* ── Tax worksheets (the founder's alone) ────────────────────── */}
      {isFounder && taxData && (
        <details id="tax" data-sec open className="zoho-sec">
          <summary className="admin-section-title" style={{ cursor: "pointer", marginTop: 26 }}>🧾 Tax worksheets — projections, working shown</summary>
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
        </details>
      )}

      {/* ── Build state ─────────────────────────────────────────────── */}
      {/* A progress list for whoever is building this, not something the desk
          acts on. It sat open between the day's work and his approvals gate. */}
      <details style={{ marginTop: 24 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: ".85rem" }}>Where the build stands</summary>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
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
      </details>

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
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
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

      {/* ── The document vault — the whole zoho area (founder + Pradeep) ── */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }} id="vault">🗄️ Document vault</h2>
      {/* ONE LINE OF WHAT IT IS; THE MECHANICS FOLD AWAY.
          The guarded route and who may delete are true and worth recording, but
          they are not what somebody filing a statement needs to read first. */}
      <p className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
        Every paper the desk works from, filed by <strong>year → institution</strong>.
      </p>
      <details style={{ margin: "6px 0 0" }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: ".8rem" }}>What belongs here, and who can remove it</summary>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 6, lineHeight: 1.7 }}>
          Bank and card statements, brokerage statements, 26AS and AIS/TIS, returns and computations, challans,
          invoices and agreements — the raw file or a processed one, whichever you have. Files open through this
          desk&apos;s own guarded route rather than the general file proxy, and deleting is the founder&apos;s alone.
        </p>
      </details>

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
