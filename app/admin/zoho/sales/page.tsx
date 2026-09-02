import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoConfigured } from "@/lib/zohoApi";
import { formatINR } from "@/lib/pricing";
import { listZohoAccounts } from "@/lib/bankStatements";
import { saleEntry } from "@/lib/entryPreview";
import type { SalePayload } from "@/lib/zohoPosting";
import { INDIA_STATES } from "@/lib/indiaStates";
import EntryEditor from "../EntryEditor";
import EntryLines from "../EntryLines";
import SubmitButton from "@/app/components/SubmitButton";
import DeskShell from "../_shell";
import {
  scanSalesAction, approvePostingAction, approveAllDraftsAction, skipPostingAction,
  retryPostingAction, editSalePayloadAction,
} from "../actions";

// THE SALES QUEUE, ON ITS OWN PAGE.

export const dynamic = "force-dynamic";

type PostingRow = { id: string; source_table: string; order_no: number | null; status: string;
  payload: SalePayload; zoho_invoice_number: string | null; error: string | null; posted_at: string | null };

export default async function SalesQueuePage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();

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

  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];
  const incomeChoices = zohoAccounts.filter((a) => a.type === "income" || a.type === "other_income").map((a) => a.name);

  return (
    <DeskShell
      badge="📮 Sales → Zoho"
      title="Sales"
      subtitle="Each paid portal sale becomes a draft here. Approving posts it to Zoho with the portal's own CAPS invoice number and the E-series receipt."
      current="/admin/zoho/sales"
      message={sp.scan}
    >

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
  <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
    Each paid portal sale becomes a draft here. Approving posts it to Zoho exactly as the office does by
    hand: the portal&apos;s own CAPS invoice number, booked to Sales-Classes (Sales-Validity for extensions),
    SAC 999293, and the payment into Razorpay Clearing with the E-series receipt. Anything the office has
    already entered manually is recognised by its order number and left alone.
  </p>

  <datalist id="income-ledgers">
    {incomeChoices.map((n) => <option key={n} value={n} />)}
  </datalist>
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

      {/* THE ENTRY, AND THE TWO THINGS ON IT THAT ARE OURS TO DECIDE.
          The amount is what Razorpay collected and the customer is
          whoever paid — neither is editable, and pretending otherwise
          would be an edit box over a receipt. The buyer's state (the
          GST split) and the income ledger are ours, and both are read
          from this payload by the posting itself. */}
      <details style={{ marginTop: 8 }}>
        <summary className="btn small secondary as-btn">📖 Journal entry — check &amp; edit</summary>
        <EntryLines
          entry={saleEntry({
            who: String(r.payload.customer || "the student"),
            account: String(r.payload.salesAccount || (r.payload.extension ? "Sales-Validity" : "Sales-Classes")),
            gstTreatment: "charged", gstRate: 18,
            intraState: r.payload.stateCode === "DL",
            amount: Number(r.payload.amountInr) || 0,
            inclusiveGross: Number(r.payload.amountInr) || 0,
            settledInto: "Razorpay Clearing",
          })}
          title="What posting this sale writes"
          compact
        />
        <form action={editSalePayloadAction} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
          <input type="hidden" name="id" value={r.id} />
          <div>
            <label style={{ fontSize: ".72rem" }}>Buyer&apos;s state (decides CGST+SGST vs IGST)</label>
            <select name="state_name" defaultValue="" style={{ marginBottom: 0 }}>
              <option value="">— keep {r.payload.stateCode || "unset"} —</option>
              {INDIA_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: ".72rem" }}>Income ledger — pick one or type any</label>
            <input name="sales_account" list="income-ledgers"
                   defaultValue={String(r.payload.salesAccount || (r.payload.extension ? "Sales-Validity" : "Sales-Classes"))}
                   style={{ marginBottom: 0, minWidth: 220 }} />
          </div>
          <SubmitButton className="btn small secondary" savedLabel="✓ Reworked">💾 Save &amp; rework the entry</SubmitButton>
          <span className="muted" style={{ fontSize: ".74rem" }}>
            ₹{Number(r.payload.amountInr).toLocaleString("en-IN")} is the money Razorpay collected — not editable.
          </span>
        </form>
      </details>
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
    </DeskShell>
  );
}
