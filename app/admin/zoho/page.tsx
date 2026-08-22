import AdminHero from "../_components/AdminHero";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";
import { getSecret } from "@/lib/secrets";
import { zohoConfigured } from "@/lib/zohoApi";
import SubmitButton from "@/app/components/SubmitButton";
import PdfUpload from "../_components/PdfUpload";
import DeleteButton from "../_components/DeleteButton";
import { addVaultDoc, deleteVaultDoc, connectZoho, scanSalesAction, approvePostingAction, approveAllDraftsAction, skipPostingAction, retryPostingAction, scanSettlementsAction, approveSettlementAction, approveAllSettlementsAction, skipSettlementAction, retrySettlementAction, uploadStatementAction, answerLineAction, approveAutoLineAction, approveAllAutoAction, skipLineAction, retryLineAction, addPettyPersonAction, recordAdvanceAction, approveBillAction, rejectBillAction, retryBillAction } from "./actions";
import { listZohoAccounts } from "@/lib/bankStatements";
import { pettyBalances } from "@/lib/pettyCash";
import { rule115Rate } from "@/lib/forexRates";
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
  { name: "Hub & founder's vault", what: "This page, the access grant, and the founder-only document vault.", state: "done" },
  { name: "Zoho connection", what: "The portal's own Self-Client key — connected to ALDINECA.", state: "done" },
  { name: "Rulebook", what: "Learned from the office's own FY26-27 entries and locked: same series, same accounts, same style — automatically.", state: "done" },
  { name: "Sales posting", what: "Every paid portal sale becomes a draft in the queue below; approving posts the CAPS invoice + payment to Zoho.", state: "done" },
  { name: "Razorpay settlements", what: "Fetched from Razorpay, one journal each: net to Axis, fee+GST to Payment Gateway Charges (AI), gross out of clearing — queue below.", state: "done" },
  { name: "Bank statements", what: "Upload per account (CSV/Excel/PDF) → matched / rule-proposed / ask-once queues, continuity checks — section below.", state: "done" },
  { name: "Petty cash (advances)", what: "Record advances, per-person balances, bill uploads on /admin/petty, approve → posts to Zoho — section below.", state: "done" },
  { name: "Rule-115 rates", what: "SBI TT buying rates auto-fetched from officialforexrates.com (the founder's sole authority), stored with provenance, holiday walk-back — card below.", state: "done" },
  { name: "Rent roll & GST/TDS", what: "Co-owned commercial rent (two invoices, TDS per PAN), residential rent.", state: "planned" },
  { name: "Cards, brokerage & tax engines", what: "Card statements, US brokerage at cost with FIFO gains, India advance-tax + US 1040-ES projections, CPA packs, all reconciliations.", state: "planned" },
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
  searchParams: Promise<{ zoho_ok?: string; zoho_err?: string; scan?: string }>;
}) {
  await assertArea("zoho");
  const sp = await props.searchParams;
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

  const { data: docs } = isFounder
    ? await createServiceClient().from("zoho_vault_docs").select("id, title, note, created_at").order("created_at", { ascending: false })
    : { data: [] as { id: string; title: string; note: string | null; created_at: string }[] };

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

          {sDrafts.length === 0 && sFailed.length === 0 && (
            <div className="card"><p className="muted" style={{ margin: 0 }}>No settlements waiting. 🔄 Fetch pulls the latest from Razorpay.</p></div>
          )}

          {[...sFailed, ...sDrafts].map((r) => (
            <div className="card" key={r.id} style={{ marginTop: 8, borderLeft: `4px solid ${r.status === "failed" ? "#b91c1c" : "var(--accent)"}` }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{r.settled_on}</strong>
                <span style={{ flex: 1, minWidth: 240, fontSize: ".88rem" }}>
                  net <strong>{formatINR(Number(r.net_inr))}</strong> to Axis · fee+GST {formatINR(Number(r.fees_inr) + Number(r.tax_inr))} · gross {formatINR(Number(r.gross_inr))}
                  <span className="muted"> · UTR {r.utr || "—"} · {r.settlement_id}</span>
                </span>
                {r.status === "draft" ? (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <form action={approveSettlementAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn small" savedLabel="✓ Posted">✅ Approve &amp; post</SubmitButton>
                    </form>
                    <form action={skipSettlementAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Skip</SubmitButton>
                    </form>
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: ".78rem", color: "#b91c1c" }}>{r.error}</span>
                    <form action={retrySettlementAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">↻ Retry</SubmitButton>
                    </form>
                  </span>
                )}
              </div>
            </div>
          ))}

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
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
                <strong>⚡ Rule-proposed — one tick posts ({autoLines.length})</strong>
                <form action={approveAllAutoAction} style={{ margin: 0 }}>
                  <SubmitButton className="btn small" savedLabel="✓ Posted">✅ Approve all</SubmitButton>
                </form>
              </div>
              {autoLines.map((l) => (
                <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>{l.line_date}</span>
                    <span style={{ flex: 1, minWidth: 220, fontSize: ".84rem" }}>{l.narration}</span>
                    <strong style={{ whiteSpace: "nowrap" }}>{l.debit > 0 ? `− ${formatINR(Number(l.debit))}` : `+ ${formatINR(Number(l.credit))}`}</strong>
                    <span className="badge">→ {l.proposal?.account}</span>
                    <form action={approveAutoLineAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn small" savedLabel="✓">✅ Post</SubmitButton>
                    </form>
                    <form action={skipLineAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Skip</SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
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

      {/* ── Rule 115 rate card ──────────────────────────────────────── */}
      {r115 && (
        <div className="card" style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <strong>💱 Rule 115 — USD rate for income arising this month:</strong>
          <span style={{ fontSize: "1.1rem", fontWeight: 800 }}>₹{r115.rate.toFixed(2)}</span>
          <span className="muted" style={{ fontSize: ".8rem" }}>
            SBI TT buying rate of {r115.rateDate}{r115.rateDate !== r115.keyDate ? ` (nearest published day before ${r115.keyDate})` : ""} · source: officialforexrates.com — every conversion stores its rate, date and rule.
          </span>
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
          <h2 className="admin-section-title" style={{ marginTop: 28 }}>🔐 Founder&apos;s document vault</h2>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
            For the papers the tax engines calibrate from: latest India ITR + computation, latest US 1040, and the
            Rule-115 rates source. <strong>Only you see this section</strong> — the Zoho area grant does not reach
            it, and files open through a founder-checked route, never the general file proxy.
          </p>

          <form action={addVaultDoc} className="card" style={{ marginTop: 10 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label>Document name</label>
                <input name="title" required placeholder="e.g. India ITR AY 2026-27 — computation" />
              </div>
              <div>
                <label>Note (optional)</label>
                <input name="note" placeholder="e.g. filed 28 Jul 2026" />
              </div>
            </div>
            <PdfUpload name="file_url" folder="zoho-vault" label="The document (PDF)" />
            <SubmitButton className="btn small" savedLabel="✓ Stored" style={{ marginTop: 8 }}>🔐 Store in the vault</SubmitButton>
          </form>

          {docs && docs.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {docs.map((d) => (
                <div className="card" key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px" }}>
                  <a href={`/api/zoho-vault?d=${d.id}`} target="_blank" rel="noopener noreferrer" className="grad" style={{ fontWeight: 700 }}>
                    📄 {d.title}
                  </a>
                  {d.note && <span className="muted" style={{ fontSize: ".8rem" }}>{d.note}</span>}
                  <span className="muted" style={{ fontSize: ".78rem", marginLeft: "auto" }}>{formatDate(d.created_at)}</span>
                  <DeleteButton action={deleteVaultDoc} id={d.id} message="Remove this document from the vault? (The stored file itself is kept.)" />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── For the accounts operator ───────────────────────────────── */}
      {!isFounder && (
        <div className="card" style={{ marginTop: 24 }}>
          <strong>👋 This desk is being built for you</strong>
          <p className="muted" style={{ fontSize: ".88rem", margin: "6px 0 0", lineHeight: 1.7 }}>
            When it goes live you will work only here: statements come in, the system prepares the entries, you
            approve them, and they post to Zoho Books by themselves. Until then there is nothing for you to do on
            this page.
          </p>
        </div>
      )}
    </section>
  );
}
